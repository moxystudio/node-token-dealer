# token-dealer

[![NPM version][npm-image]][npm-url] [![Downloads][downloads-image]][npm-url] [![Build Status][travis-image]][travis-url] [![Coverage Status][coveralls-image]][coveralls-url] [![Dependency status][david-dm-image]][david-dm-url] [![Dev Dependency status][david-dm-dev-image]][david-dm-dev-url]

[npm-url]:https://npmjs.org/package/token-dealer
[downloads-image]:http://img.shields.io/npm/dm/token-dealer.svg
[npm-image]:http://img.shields.io/npm/v/token-dealer.svg
[travis-url]:https://travis-ci.org/IndigoUnited/node-token-dealer
[travis-image]:http://img.shields.io/travis/IndigoUnited/node-token-dealer.svg
[coveralls-url]:https://coveralls.io/r/IndigoUnited/node-token-dealer
[coveralls-image]:https://img.shields.io/coveralls/IndigoUnited/node-token-dealer.svg
[david-dm-url]:https://david-dm.org/IndigoUnited/node-token-dealer
[david-dm-image]:https://img.shields.io/david/IndigoUnited/node-token-dealer.svg
[david-dm-dev-url]:https://david-dm.org/IndigoUnited/node-token-dealer#info=devDependencies
[david-dm-dev-image]:https://img.shields.io/david/dev/IndigoUnited/node-token-dealer.svg

Circumvent API rate limits by having several API tokens and let the dealer manage and give them to you.

Several public APIs, such as GitHub and Twitter, have rate limits applied per account. To multiply these rate limits, you must have a farm of tokens associated to multiple accounts, either donated or created by you. This is where `token-dealer` comes in, making it easy to
manage these tokens and their usage.


## Installation

`$ npm install token-dealer`


## Usage

### tokenDealer(tokens, fn, [options])

Calls `fn(token, exhaust)` with the most appropriate `token` from `tokens` and an `exhaust` function that you may call to signal that the token is exhausted.

Basically the only thing you must do is call `exhaust(reset, [failed])` whenever you know that the token may not be used again until `reset` (timestamp in ms). Additionally, you may pass `failed=true` if the operation you were trying to do with the token failed because its rate limit was reached. If the promise is rejected and `exhaust` was called with `failed=true`, `fn` will be called again but with a different token.

Here's an example from a request to the [GitHub API](https://developer.github.com/v3/#rate-limiting) using [got](https://www.npmjs.com/package/got):

```js
const tokenDealer = require('tokenDealer');
const got = require('got');

const tokens = [
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
];

tokenDealer(tokens, (token, exhaust) => {
    const handleRateLimit = (response, err) => {
        if (response.headers['x-ratelimit-remaining'] === '0') {
            exhaust(Number(response.headers['x-ratelimit-reset']) * 1000, err && err.statusCode === 403);
        }
    };

    return got('https://api.github.com/repos/IndigoUnited/node-cross-spawn', {
        json: true,
        headers: { Authorization: `token ${token}` },
    })
    .then((response) => {
        handleRateLimit(response);
        return response;
    }, (err) => {
        err.response && handleRateLimit(err.response, err);
        throw err;
    });
})
.then((response) => {
    // ...
});
```

Available options:

- `group`: The group associated to the tokens; this effectively groups tokens to prevent conflicts (e.g. `github`, defaults to `default`).
- `wait`: True to wait for a token to be free in case all are exhausted (defaults to `false`); alternatively you may pass a function that will be called with `[token, delay]` so that you can decide to wait dynamically.
- `lru`: A custom [LRU cache](https://www.npmjs.com/package/lru-cache) instance to be used internally.


If `tokens` is nullish or an empty array, the token given to `fn` will be `null`.


### tokenDealer.getTokensUsage(tokens, [options])

Get the tokens usage for `tokens`. The available options are `group` and `lru` which are the same as `tokenDealer()`.

```js
const tokenDealer = require('tokenDealer');

const tokens = [
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
];

const usage = tokenDealer.getTokensUsage(tokens);

// `usage` looks like this:
// {
//     'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa': {
//         exhausted: true,       // true if exhausted, false otherwise
//         reset: 1455996883369,  // the timestamp in which the token will become available again
//         pending: 0,            // the number of deliveries (`fn` calls) that still haven't completed
//     },
//     'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb': {
//         // ...
//     }
// }
```


## Tests

`$ npm test`   
`$ npm test-cov` to get coverage report


## License

Released under the [MIT License](http://www.opensource.org/licenses/mit-license.php).
