module.exports = {
	plugins: [
		require('autoprefixer'),
		...process.env.HUGO_ENVIRONMENT === 'production'
			? [
				require('@fullhuman/postcss-purgecss')({
					content: [
						"./layouts/**/*.html",
					],
				})
			] : []
	]
}
