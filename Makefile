.DEFAULT_GOAL := help

.PHONY: help test check package

help:
	@printf '%s\n' 'Available targets:' '  make test    Run rule-generation tests.' '  make check   Validate JSON and JavaScript syntax.' '  make package Create dist/cf-access-header-injector.zip.'

test:
	node --test tests/*.test.cjs

check: test
	node --check background.js
	node --check options.js
	node --check rules.js
	node -e "JSON.parse(require('node:fs').readFileSync('manifest.json')); JSON.parse(require('node:fs').readFileSync('rules.json'));"

package: check
	mkdir -p dist
	zip -r dist/cf-access-header-injector.zip manifest.json background.js options.html options.js options.css rules.js rules.json -x '*.DS_Store'
