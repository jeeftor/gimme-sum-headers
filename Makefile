.DEFAULT_GOAL := help

PACKAGE_FILES := manifest.json background.js options.html options.js options.css popup.html popup.js popup.css rules.js rules.json \
	icons/icon-16.png icons/icon-32.png icons/icon-48.png icons/icon-128.png
PACKAGE_EPOCH ?= $(shell git log -1 --format=%ct 2>/dev/null || printf 315532800)
FIREFOX_WEB_EXT_VERSION := 9.4.0

.PHONY: help test check stage chrome-stage firefox-stage package firefox-package firefox-lint

help:
	@printf '%s\n' 'Available targets:' '  make test            Run rule-generation tests.' '  make check           Validate JSON and JavaScript syntax.' '  make package         Create the deterministic Chrome Web Store ZIP.' '  make firefox-package Create the deterministic Firefox AMO upload ZIP.' '  make firefox-lint    Lint the staged Firefox extension with web-ext.'

test:
	node --test tests/*.test.cjs

check: test
	node --check background.js
	node --check options.js
	node --check popup.js
	node --check rules.js
	node --check scripts/check-release-version.mjs
	node scripts/check-amo-metadata.mjs
	node --check scripts/sync-amo-listing-assets.mjs
	node --check scripts/prepare-browser-package.mjs
	node --check scripts/publish-chrome-store.mjs
	node --check scripts/stage-package.mjs
	node -e "JSON.parse(require('node:fs').readFileSync('manifest.json')); JSON.parse(require('node:fs').readFileSync('rules.json'));"

stage:
	SOURCE_DATE_EPOCH="$(PACKAGE_EPOCH)" node scripts/stage-package.mjs dist/package $(PACKAGE_FILES)

chrome-stage: stage
	SOURCE_DATE_EPOCH="$(PACKAGE_EPOCH)" node scripts/prepare-browser-package.mjs chrome dist/package dist/chrome-package

firefox-stage: stage
	SOURCE_DATE_EPOCH="$(PACKAGE_EPOCH)" node scripts/prepare-browser-package.mjs firefox dist/package dist/firefox-package

package: check chrome-stage
	rm -f dist/gimme-sum-headers-chrome.zip
	cd dist/chrome-package && TZ=UTC zip -X -q ../gimme-sum-headers-chrome.zip $(PACKAGE_FILES)

firefox-package: check firefox-stage
	rm -f dist/gimme-sum-headers-firefox.zip
	cd dist/firefox-package && TZ=UTC zip -X -q ../gimme-sum-headers-firefox.zip $(PACKAGE_FILES)

firefox-lint: firefox-stage
	NO_UPDATE_NOTIFIER=1 npm_config_cache=.npm-cache npx --yes web-ext@$(FIREFOX_WEB_EXT_VERSION) lint --source-dir dist/firefox-package
