.PHONY: all
all: build

.PHONY: build
build:
	hugo

.PHONY: clean
clean:
	rm -rf ./public/
	rm -rf ./resources/_gen/
