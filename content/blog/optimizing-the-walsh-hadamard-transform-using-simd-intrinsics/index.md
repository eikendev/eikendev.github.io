---
title: "Optimizing the Walsh-Hadamard Transform Using SIMD Intrinsics"
date: 2020-03-31T20:58:27+02:00
tags: ["performance", "simd", "intrinsics"]
chartjs: true
mathjax: true
---

I'm currently studying fast numeric code at university, where I've been confronted with the problem of optimizing the [Walsh-Hadamard transform](https://en.wikipedia.org/wiki/Hadamard_transform) using SIMD intrinsics.
To be honest, I don't know a lot about the maths behind it, but apparently it has a lot of applications, specifically in cryptography, signal processing and quantum computing.

Since it was so much fun to apply my fresh knowledge about intrinsics on a real-world problem, I thought it may be worth sharing this experience here on my blog.
Be aware though that I'm not an intrinsics-guru, which is why there is certainly more optimized code available.[^1]

If you have never heard of intrinsics, you should definitely read [this article](https://jackmott.github.io/programming/2016/07/22/making-obvious-fast.html) that shows how much performance can be gained in various programming languages when the right instructions are used.

Also note that in the following, we will measure performance in flops per cycle.
That is, given a program, we evaluate how many floating point operations are needed to run the program, and measure how many cycles the program took to complete.
Luckily for me, this whole environment was provided by my university, but in theory it could be done locally, too.
You'll just have to get a way of accurately measure the cycle count, which is a bit more tricky than it sounds.

For the expert readers, the measured program will be compiled using GCC 8.3.1 with the flags `-O3 -fno-tree-vectorize -mavx2 -mfma`.
The processor is a [Intel Xeon Silver 4210](https://ark.intel.com/content/www/us/en/ark/products/193384/intel-xeon-silver-4210-processor-13-75m-cache-2-20-ghz.html).
Even if Intel® AVX-512 instructions are supported on this chip, we'll be limiting ourselves to Intel® AVX2.

## Understanding the problem

Alright, so what is the task?
We're given a vector \\(x\\) with eight doubles, and want to transform it using the Walsh-Hadamard matrix \\(H_8\\).
\\[
	H_8 \times x =
	\begin{bmatrix}
        1 &  1 &  1 &  1 &  1 &  1 &  1 &  1 \\\\
        1 & -1 &  1 & -1 &  1 & -1 &  1 & -1 \\\\
        1 &  1 & -1 & -1 &  1 &  1 & -1 & -1 \\\\
        1 & -1 & -1 &  1 &  1 & -1 & -1 &  1 \\\\
        1 &  1 &  1 &  1 & -1 & -1 & -1 & -1 \\\\
        1 & -1 &  1 & -1 & -1 &  1 & -1 &  1 \\\\
        1 &  1 & -1 & -1 & -1 & -1 &  1 &  1 \\\\
        1 & -1 & -1 &  1 & -1 &  1 &  1 & -1 \\\\
	\end{bmatrix}
	\times x
\\]

We can see right away that there sure is some pattern to the signs of the matrix.
This is no coincidence.
The Walsh-Hadamard transform can be defined as
\\[
	H_m =
	\begin{bmatrix}
        H_{m-1} & H_{m-1} \\\\
        H_{m-1} & -H_{m-1} \\\\
	\end{bmatrix}
\\]
where \\(H_0 = 1\\) and \\(m > 0\\).
This means the matrix will always be square, and all four quarters are identical, except that the lower right quarter is negated.
Of course, we will exploit this property later in our code.

So, let's try to write a first implementation without any intrinsics at all.
First off, let me exactly define the input `A` and the expected output `C`.
We want to apply the transform to all column vectors of `A`, where `A` is stored in a column-major order, which means the columns are contiguous in memory.
This means with `A[0]`, we can access the first column, which consists of 8 doubles.
`C` is a matrix of the same dimension as `A`, but all columns are the result of a transformation with a column of `A`.
In essence, we are thereby calculating \\(C = H_8 \times A\\).

The following defines help us access the matrix sizes in code.

```cpp
#define NR (8) // Number of rows.
#define MR (75) // Number of columns.
```

Without intrinsics, we only need a simple loop that iterates over all columns and applies the transform like so.

```cpp
static void wht_composed_novectors(double* A, double* C)
{
    double *a = A;
    double *c = C;

    for (int i = 0; i < MR; ++i) {
        c[0] = a[0] + a[1] + a[2] + a[3] + a[4] + a[5] + a[6] + a[7];
        c[1] = a[0] - a[1] + a[2] - a[3] + a[4] - a[5] + a[6] - a[7];
        c[2] = a[0] + a[1] - a[2] - a[3] + a[4] + a[5] - a[6] - a[7];
        c[3] = a[0] - a[1] - a[2] + a[3] + a[4] - a[5] - a[6] + a[7];
        c[4] = a[0] + a[1] + a[2] + a[3] - a[4] - a[5] - a[6] - a[7];
        c[5] = a[0] - a[1] + a[2] - a[3] - a[4] + a[5] - a[6] + a[7];
        c[6] = a[0] + a[1] - a[2] - a[3] - a[4] - a[5] + a[6] + a[7];
        c[7] = a[0] - a[1] - a[2] + a[3] - a[4] + a[5] + a[6] - a[7];

        a += NR;
        c += NR;
    }
}
```

For this code, the performance measuring black box outputs 0.6 flops per cycle.
What does this mean?
Roughly speaking, it means that every cycle on average that many floating point operations complete.

For comparison, the processor on which the measurement was made has a throughput of 2 flops per cycle for the vectorized addition, `vaddsd`.
You can check this yourself in the [instruction table maintained by Agner Fog](https://www.agner.org/optimize/), which is an excellent resource for optimizing code at assembly level.

We know the CPU would be able to process two floating point additions per cycle, but our code makes only partially use of that capability.

Now why do I compare the result to a vectorized addition, even though we are passing the `-fno-tree-vectorize` flag to GCC?
If you write a simple program that adds two doubles and compile it with the flag, you can see that in assembly the `vaddsd` instruction is indeed used.
The suffix `sd` here means that it's [a scalar double precision operation](https://stackoverflow.com/a/16218793), so only one double addition is being performed.
I guess GCC does not count using scalar SIMD instructions as vectorization, which makes sense.

## Introducing vector intrinsics

So what can we do to improve?
If you look at the loop above, you see that in each row, we want to sum all components of the row.
The only difference is that different signs are being used.

But we've already heard that there's a pattern somewhere.
So if you look closely to the quarters on the left of the transform matrix, they appear to be exactly the same.
Comparing it with the loop in `wht_composed_novectors()`, we can clearly see that the operands are also the same.
Hence, we could calculate the results of the sums in the upper left quarter, and use these for the calculations in the lower left quarter.

As for the right quarters, things are very similar.
The only difference are the signs.
So if we calculate the sums in the upper right quarter, we can negate the results and use it for the sums in the lower right quarter.

In total, we can now save calculating the upper four values of `c`, and replace it with a single subtraction!

Let's suppose for a moment that we found a simple way to calculate the lower four values.
Then our source code could look like this.

```cpp
static void wht_composed_vectors(double* A, double* C)
{
    const __m256d aamm = _mm256_set_pd(-1.0, -1.0, 1.0, 1.0);
    const __m256d amam = _mm256_set_pd(-1.0, 1.0, -1.0, 1.0);

    double *a = A;
    double *c = C;

    for (int i = 0; i < MR; ++i) {
        const __m256d al = _mm256_load_pd(a + 0);
        const __m256d ah = _mm256_load_pd(a + 4);

        const __m256d cl = wht4x4(aamm, amam, al);
        const __m256d ch = wht4x4(aamm, amam, ah);

        _mm256_store_pd(c + 0, _mm256_add_pd(cl, ch));
        _mm256_store_pd(c + 4, _mm256_sub_pd(cl, ch));

        a += NR;
        c += NR;
    }
}
```

`aamm` and `amam` are constants that we'll use later on.
What's important is the overall concept on the higher level.

First, we load the lower and the higher four doubles of our input columns.
Next, we apply the `wht4x4()` function that returns us the addition of all four doubles in both loaded vectors.
Finally, using these sums, we can easily calculate all entries of the output vector using a single addition and a subtraction.

Now, how does `wht4x4()` work?
I already knew what I was looking for at this point, but it was quite tricky to choose the right instructions.
When browsing the Internet I found [this answer on StackOverflow](https://stackoverflow.com/a/54133143), which did not calculate the correct results.
However, after some on-paper debugging I fixed the errors and was left with the following piece of code.

```cpp
static const inline __m256d wht4x4(const __m256d aamm, const __m256d amam, __m256d a)
{
    // [a1, a0, a3, a2]
    __m256d a1032 = _mm256_permute_pd(a, 0b0101);

    // [a0 + a1, a0 - a1, a2 + a3, a2 - a3]
    __m256d a01012323 = _mm256_fmadd_pd(a, amam, a1032);

    // [a2 + a3, a2 - a3, a0 + a1, a0 - a1]
    __m256d a23230101 = _mm256_permute2f128_pd(a01012323, a01012323, 0b00000001);

    // [a0 + a1 + a2 + a3, a0 - a1 + a2 - a3, a0 + a1 - a2 - a3, a0 - a1 - a2 + a3]
    __m256d ret = _mm256_fmadd_pd(a01012323, aamm, a23230101);

    return ret;
}
```

Let's approach this in a more abstract way.
We have a tuple \\(a = (a_1, a_0, a_3, a_2)\\) as input, and want calculate \\[a' = (a_0 + a_1 + a_2 + a_3, a_0 - a_1 + a_2 - a_3, a_0 + a_1 - a_2 - a_3, a_0 - a_1 - a_2 + a_3).\\]
As a reminder, this is what is needed to calculate the upper left quarter in the loop of the simple implementation.
`wht4x4()` calculates \\(a'\\) in four steps.

First, we perform a permutation, where we swap the first half of the vector and the second half individually.
This is needed, because we need to somehow "move" an \\(a_1\\) to the beginning of the vector, and a \\(a_0\\) to the second entry of the vector.
The same holds for \\(a_2\\) and \\(a_3\\) respectively.

In the second step, two arithmetic operations are performed in a single FMA instruction.
FMA allows for a multiplication followed by an addition in a single instruction.
But it only comes at the cost of a multiplication, so it can give really good performance boosts.

What does this FMA do then?
It takes the vector we got from the first step, multiplies it with `amam`, and adds it to the input vector.
`amam` contains the values \\((1, -1, 1, -1)\\), so the step results in the vector \\[(a_0 + a_1, a_0 - a_1, a_2 + a_3, a_2 - a_3).\\]
With that, we're practically already halfway done with calculating \\(a'\\).

In the next step, we take the vector that was just retrieved, and swap the lower half with the upper half, which gives \\[(a_2 + a_3, a_2 - a_3, a_0 + a_1, a_0 - a_1).\\]

Finally, we use another FMA to combine the two vectors from the previous steps.
This time we make use of the constant `aamm`, which contains the values \\((1, 1, -1, -1)\\).
And there we have \\(a'\\).

Note that the constants `amam` and `aamm` are only defined once in the beginning.
The compiler *might* optimize this on its own, but you never know.

Further, instead of multiplying the columns `a` and `c` depending on the iterating variable `i`, we explicitly increment them by the column size in each iteration.
This is called [strength reduction](https://en.wikipedia.org/wiki/Strength_reduction).
Usually, compilers will do these kinds of optimizations on their own, but in complex cases they might not.
This is why I opted to explicitly tell the compiler to use additions here.

So what does our black box say after all these little optimizations.
We've reached 4.9 flops per second.
That's a performance speedup of over 8x!

## Composed or decomposed?

Is there anything left to optimize that's "easily" approachable?

So far I've only told half the story, because in fact I read the assignment the wrong way.
We were supposed to calculate the transform in three steps.

The matrix can actually be decomposed so that \\(H_8 = T_3 \times T_2 \times T_1\\).
In full verbosity, here are the complete matrices for that.

\\[
	T_1 =
	\begin{bmatrix}
		1 &    &    &    &  1 &    &    &    \\\\
		  &  1 &    &    &    &  1 &    &    \\\\
		  &    &  1 &    &    &    &  1 &    \\\\
		  &    &    &  1 &    &    &    &  1 \\\\
		1 &    &    &    & -1 &    &    &    \\\\
		  &  1 &    &    &    & -1 &    &    \\\\
		  &    &  1 &    &    &    & -1 &    \\\\
		  &    &    &  1 &    &    &    & -1 \\\\
	\end{bmatrix}
	\quad
	T_2 =
	\begin{bmatrix}
		1 &    &  1 &    &    &    &    &    \\\\
		  &  1 &    &  1 &    &    &    &    \\\\
		1 &    & -1 &    &    &    &    &    \\\\
		  &  1 &    & -1 &    &    &    &    \\\\
		  &    &    &    &  1 &    &  1 &    \\\\
		  &    &    &    &    &  1 &    &  1 \\\\
		  &    &    &    &  1 &    & -1 &    \\\\
		  &    &    &    &    &  1 &    & -1 \\\\
	\end{bmatrix}
	\quad
	T_3 =
	\begin{bmatrix}
		1 &  1 &    &    &    &    &    &    \\\\
		1 & -1 &    &    &    &    &    &    \\\\
		  &    &  1 &  1 &    &    &    &    \\\\
		  &    &  1 & -1 &    &    &    &    \\\\
		  &    &    &    &  1 &  1 &    &    \\\\
		  &    &    &    &  1 & -1 &    &    \\\\
		  &    &    &    &    &    &  1 &  1 \\\\
		  &    &    &    &    &    &  1 & -1 \\\\
	\end{bmatrix}
\\]

Note that the spaces are filled with zeros, it's just a lot more readable this way.
If you multiply these matrices by hand as given above, you will get the exact \\(H_8\\) which was introduced in the beginning.

So let's try to implement this.
This time we have three different transformations.
Luckily, we'll encounter the same patterns as in the first SIMD implementation.

```cpp
static void wht_decomposed_vectors(double* A, double* C)
{
    const __m256d aamm = _mm256_set_pd(-1.0, -1.0, 1.0, 1.0);
    const __m256d amam = _mm256_set_pd(-1.0, 1.0, -1.0, 1.0);

    double *a = A;
    double *c = C;

    int i;

    for (i = 0; i < MR - 4; i += 4) {
        // Load the input rows.

        const __m256d a0l = _mm256_load_pd(a + (0 * NR) + 0);
        const __m256d a0h = _mm256_load_pd(a + (0 * NR) + 4);

        const __m256d a1l = _mm256_load_pd(a + (1 * NR) + 0);
        const __m256d a1h = _mm256_load_pd(a + (1 * NR) + 4);

        const __m256d a2l = _mm256_load_pd(a + (2 * NR) + 0);
        const __m256d a2h = _mm256_load_pd(a + (2 * NR) + 4);

        const __m256d a3l = _mm256_load_pd(a + (3 * NR) + 0);
        const __m256d a3h = _mm256_load_pd(a + (3 * NR) + 4);

        // Apply the first transformation.

        const __m256d c00l = transform1a(a0l, a0h);
        const __m256d c00h = transform1b(a0l, a0h);

        const __m256d c01l = transform1a(a1l, a1h);
        const __m256d c01h = transform1b(a1l, a1h);

        const __m256d c02l = transform1a(a2l, a2h);
        const __m256d c02h = transform1b(a2l, a2h);

        const __m256d c03l = transform1a(a3l, a3h);
        const __m256d c03h = transform1b(a3l, a3h);

        // Apply the second transformation.

        const __m256d c10l = transform2(aamm, c00l);
        const __m256d c10h = transform2(aamm, c00h);

        const __m256d c11l = transform2(aamm, c01l);
        const __m256d c11h = transform2(aamm, c01h);

        const __m256d c12l = transform2(aamm, c02l);
        const __m256d c12h = transform2(aamm, c02h);

        const __m256d c13l = transform2(aamm, c03l);
        const __m256d c13h = transform2(aamm, c03h);

        // Apply the third transformation.

        const __m256d c20l = transform3(amam, c10l);
        const __m256d c20h = transform3(amam, c10h);

        const __m256d c21l = transform3(amam, c11l);
        const __m256d c21h = transform3(amam, c11h);

        const __m256d c22l = transform3(amam, c12l);
        const __m256d c22h = transform3(amam, c12h);

        const __m256d c23l = transform3(amam, c13l);
        const __m256d c23h = transform3(amam, c13h);

        // Write the output rows.

        _mm256_store_pd(c + (0 * NR) + 0, c20l);
        _mm256_store_pd(c + (0 * NR) + 4, c20h);

        _mm256_store_pd(c + (1 * NR) + 0, c21l);
        _mm256_store_pd(c + (1 * NR) + 4, c21h);

        _mm256_store_pd(c + (2 * NR) + 0, c22l);
        _mm256_store_pd(c + (2 * NR) + 4, c22h);

        _mm256_store_pd(c + (3 * NR) + 0, c23l);
        _mm256_store_pd(c + (3 * NR) + 4, c23h);

        // Adjust the pointers for the next four rows.

        a += 4 * NR;
        c += 4 * NR;
    }
}
```

Woah, that looks complicated!
Except that it's not!
Let me explain what this does.

Again, first we define two constants as before.
Then, the loop will increment in steps of four this time, because we will process four rows at once.
The reason for this will become clear in just a moment.

In the loop, we first load the four rows from `A`.
On each row, we apply the three different transformations \\(T_1\\), \\(T_2\\), and \\(T_3\\) in that order.
Afterwards, all four vectors are stored into `C`.

The pattern is similar to our last implementation, except that this time
- we process more rows in parallel, and
- the transformation is split into three steps.

Note that in the code above, we need to take into account that the amount of rows in our input vector is not divisible by four.
I omitted the code for handling this in the snippet, but you I'll reference the full code in the end of the post.

## Three missing pieces

Now, the only thing left to understand is how each transformation is computed.
Let's start with the first transformation.

\\(T_1\\) is relatively simple.
If you're not that familiar with matrix multiplication, here is what the transformation does for \\(x \in \mathbb{R}^8\\).
\\[
	T_1 \times x =
	\begin{bmatrix}
		x_0 + x_4 \\\\
		x_1 + x_5 \\\\
		x_2 + x_6 \\\\
		x_3 + x_7 \\\\
		x_0 - x_4 \\\\
		x_1 - x_5 \\\\
		x_2 - x_6 \\\\
		x_3 - x_7 \\\\
	\end{bmatrix}
\\]
More informally speaking, the lower half of the output is just the higher four doubles added to the lower ones, and the upper half is the higher four doubles subtracted from the lower ones.
This is exactly what `_mm256_add_pd()` and `_mm256_sub_pd()` do!
For both functions I introduced a wrapper with an appropriate name.
Since the functions will be inlined, the performance is not affected by this.

```cpp
static const inline __m256d transform1a(__m256d a, __m256d b)
{
    const __m256d ret = _mm256_add_pd(a, b);

    return ret;
}

static const inline __m256d transform1b(__m256d a, __m256d b)
{
    const __m256d ret = _mm256_sub_pd(a, b);

    return ret;
}
```

Next up is the second transformation.
Again, let me show you what we need to calculate.
\\[
	T_2 \times x =
	\begin{bmatrix}
		x_0 + x_2 \\\\
		x_1 + x_3 \\\\
		x_0 - x_2 \\\\
		x_1 - x_3 \\\\
		x_4 + x_6 \\\\
		x_5 + x_7 \\\\
		x_4 - x_6 \\\\
		x_5 - x_7 \\\\
	\end{bmatrix}
\\]

Do you see how the first half of that vector is arithmetically independent from the second half, and their arithmetic patterns are the same?
This means we can write a single function that operates only on one half.

We can use the same permutation that we used to swap the halves of the vector in the first SIMD implementation.
This is then followed by the very same FMA instruction we also used before.
In fact, this is functionally half of the `wht4x4()` function we discussed above.

```cpp
static const inline __m256d transform2(const __m256d aamm, __m256d a)
{
    // [a2, a3, a0, a1]
    const __m256d a2301 = _mm256_permute2f128_pd(a, a, 0b00000001);

    // [a0 + a2, a1 + a3, a0 - a2, a1 - a3]
    const __m256d ret = _mm256_fmadd_pd(a, aamm, a2301);

    return ret;
}
```
Lastly, with the third transformation it is kind of the same deal.
This is just the other half of the `wht4x4()` function.
For completeness, here is the calculation in vector form.
\\[
	T_3 \times x =
	\begin{bmatrix}
		x_0 + x_1 \\\\
		x_0 - x_1 \\\\
		x_2 + x_3 \\\\
		x_2 - x_3 \\\\
		x_4 + x_5 \\\\
		x_4 - x_5 \\\\
		x_6 + x_7 \\\\
		x_6 - x_7 \\\\
	\end{bmatrix}
\\]

Again, both halves can be calculated independently.

```cpp
static const inline __m256d transform3(const __m256d amam, __m256d a)
{
    // [a1, a0, a3, a2]
    const __m256d a1032 = _mm256_permute_pd(a, 0b0101);

    // [a0 + a1, a0 - a1, a2 + a3, a2 - a3]
    const __m256d ret = _mm256_fmadd_pd(a, amam, a1032);

    return ret;
}
```

So did this pay off?
Oh yes, it did!
With a performance of 5.6 flops per second, we achieved a speedup of over 9x compared to the simple version from the beginning.

## Conclusion

This is where I left it.
I'm pretty sure there are plenty things one could have done better, but I was satisfied with the performance.
You can find the complete source code [on GitHub as a Gist](https://gist.github.com/eikendev/bcadad1df680cc8b96d4e2ec99e556d2).

For a nice overview, I visualized the difference in performance for all three approaches we discussed.
I've also added a fourth measurement where I decomposed the vectors, but didn't apply any vectorization.
Interestingly, it gives a nice speedup as well.

{{< chart id="performance" width=800 height=400 >}}

[^1]: After writing this blog post, I found [this](https://en.wikipedia.org/wiki/Fast_Walsh%E2%80%93Hadamard_transform) article on Wikipedia about an efficient algorithm to compute the Walsh-Hadamard transform.
