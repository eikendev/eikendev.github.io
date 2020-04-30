.PHONY: all
all: build

.PHONY: build
build:
	hugo version
	hugo --minify
	mkdir -p public/font/mathjax
	cp node_modules/mathjax/es5/output/chtml/fonts/woff-v2/* public/font/mathjax/

.PHONY: server
server:
	mkdir -p static/font/mathjax
	cp node_modules/mathjax/es5/output/chtml/fonts/woff-v2/* static/font/mathjax/
	hugo server --minify --buildDrafts

.PHONY: clean
clean:
	rm -rf ./public/
	rm -rf ./resources/_gen/
