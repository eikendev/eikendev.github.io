---
title: "How to Deploy Your Hugo Site With Travis CI"
date: 2020-03-01T18:37:18+01:00
draft: false
tags: ["hugo", "travis", "github"]
---

## Automation time!

I finally made it.
I finally switched over to using a static site generator.
Until now I was writing pure HTML by hand.
What a mess!

I've been wanting to try Hugo for a while now.
It's just that it takes a while to become familiar with a new tool.
Luckily, I already have some experience with static site generation so it didn't take to long to identify the patterns.

So, why did I switch to using Hugo just now?
Well, in my previous setup I had to manually deploy my HTML site for every single change.
For every change, I pushed the new commit to a remote Git repository and pulled it onto a server.
My dream was to have the site automatically deploy, so why not combine a new setup with a new site?

The next thing I did was reading the documentation on both [GitHub Pages](https://pages.github.com/) and [Hugo](https://gohugo.io/).
Both projects provide very solid documentation.
I soon realized that they would fit my requirements.
However, one thing was still missing: automatic deployment.
Fortunately, it seems like there are numerous solutions to this, even [self-hosted ones](https://drone.io/).
Despite being a fanatic when it comes to self-hosting services, I went with a 'commercial' solution this time.
I recently discovered [Travis CI](https://travis-ci.org/) for myself, and I figured that this is the perfect opportunity to deepen my knowledge of it.

## Mysterious bifurcation

I proceeded with creating a site using GitHub Pages.
There are two types of pages, one's for the users or organizations themselves, and the other is used for projects.
One difference I stumbled upon later is that for user pages, only the master branch can be served by GitHub.
I'm not certain how this restriction makes sense, but it's the reason why my Hugo source lives on the `source` branch, and the deployment happens on the `master` branch.
Note that two branches do not have to share a common ancestor since a new branch can be checked out as 'orphan'.

Now, for the automatic deployment to work, two things need to be done.
First, the repository has to be enabled in the settings of Travis CI.
This tells Travis CI that it is supposed to create builds for a certain repository.
Second, a configuration file has to be added to the repository.
In my case, that configuration lives on the `source` branch.
I've set that branch as the default on GitHub, but I'm not quite sure if that was necessary.
The configuration file for Travis CI has to be named `.travis.yml`.

I've found a number of different approaches to deploying a Hugo website with Travis CI.
Some have a Hugo binary reside inside the repository, others install it during the build using `go get`.
I didn't want to have a binary in my repository that needs to be updated manually regularly.
Of course, that way one can ensure that the deployment uses the same version of Hugo as the development.
But having two recent versions should not cause any trouble regarding compatibility.

## Minimalism wins

Finally, let me show you the contents of my configuration.
Be aware that I removed the encrypted token from this listing, so you have to add it yourself when you want to use it.
On the command line, you can simply issue `travis encrypt CRATES_TOKEN="<token>" --add`, replacing `<token>` with your actual token.
I'm happy with how my solution turned out, especially since the builds are very fast and the configuration pretty sleek.

```yaml
os: linux
language: minimal
addons:
  snaps:
    - name: hugo
      channel: extended
script:
- hugo
deploy:
  provider: pages
  skip_cleanup: true
  github_token: "$GITHUB_TOKEN"
  keep_history: false
  target_branch: master
  local_dir: public
  on:
    branch: source
```

As you can see, Travis CI features an addon for [Snap](https://snapcraft.io/).
It enables us to install the extended version of Hugo, which allows us to package assets with [Hugo Pipes](https://gohugo.io/hugo-pipes/).
The language environment can be set to `minimal`, which improves the speed of our deployment and makes the log of the build a bit cleaner.

If you test this you will find that Travis CI complains that the keyword `skip_cleanup` is obsolete.
I did some research and it appears that `skip_cleanup` is removed with version two of the deployment system on Travis CI, called dpl v2.
The latest documentation still shows version one as the default version, so they will probably switch to the newer version soon.
However, using the provider names of dpl v2 does not work and throws an error on Travis CI.
I believe the current behavior is inconsistent, so I'll not bother using dpl v2 for now.

There we have it.
I'm so relieved that I'll never have to manually update the contents of the site again.
And to be honest, the new setup isn't complicated at all.
Maybe some of you can benefit from my configuration, too.
You can find the whole file on [GitHub](https://github.com/eikendev/eikendev.github.io/blob/source/.travis.yml).
