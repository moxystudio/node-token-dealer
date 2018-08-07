'use strict';

const LRU = require('lru-cache');

const defaultLru = new LRU({ max: 500 });

function retrieveTokenUsage(token, options) {
    const key = `${options.group}#${token}`;

    let tokenUsage = options.lru.get(key);

    if (!tokenUsage || (tokenUsage.exhausted && Date.now() >= tokenUsage.reset)) {
        tokenUsage = { exhausted: false, reset: null, inflight: 0 };
        options.lru.set(key, tokenUsage);
    }

    return tokenUsage;
}

function chooseToken(tokens, options) {
    const tokensUsage = getTokensUsage(tokens, options);

    const chosenTokenIndex = tokens.reduce((chosenTokenIndex, token, tokenIndex) => {
        const chosenTokenUsage = tokensUsage[tokens[chosenTokenIndex]];
        const tokenUsage = tokensUsage[token];

        // If both are exhausted, prefer the one that resets sooner
        if (chosenTokenUsage.exhausted && tokenUsage.exhausted) {
            return chosenTokenUsage.reset <= tokenUsage.reset ? chosenTokenIndex : tokenIndex;
        }

        // Prefer the token that is not exhausted
        if (chosenTokenUsage.exhausted && !tokenUsage.exhausted) {
            return tokenIndex;
        }
        if (!chosenTokenUsage.exhausted && tokenUsage.exhausted) {
            return chosenTokenIndex;
        }

        // If both ARE NOT exhausted, prefer the one with less inflight requests
        return chosenTokenUsage.inflight <= tokenUsage.inflight ? chosenTokenIndex : tokenIndex;
    }, 0);

    const chosenToken = tokens[chosenTokenIndex];
    const chosenTokenUsage = tokensUsage[chosenToken];

    return {
        token: chosenToken,
        usage: chosenTokenUsage,
        overallUsage: tokensUsage,
    };
}

function dealToken(tokens, fn, options) {
    const chosen = chooseToken(tokens, options);

    if (chosen.usage.exhausted) {
        const waitTime = chosen.usage.reset - Date.now();
        const shouldWait = typeof options.wait === 'function' ? options.wait(chosen.token, waitTime) : !!options.wait;

        if (!shouldWait) {
            return Promise.reject(Object.assign(new Error('All tokens are exhausted'), {
                code: 'EALLTOKENSEXHAUSTED',
                usage: chosen.overallUsage,
            }));
        }

        return new Promise((resolve) => setTimeout(resolve, waitTime))
        .then(() => dealToken(tokens, fn, options));
    }

    chosen.usage.inflight += 1;

    return Promise.resolve()
    .then(() => fn(chosen.token, (reset, retry) => {
        chosen.usage.exhausted = true;
        chosen.usage.reset = reset;

        options.onExhausted && options.onExhausted(chosen.token, reset);

        if (retry) {
            throw Object.assign(new Error('Token is exhausted, retrying..'), { code: 'ETOKENEXHAUSTED' });
        }
    }))
    .then((val) => {
        chosen.usage.inflight -= 1;

        return val;
    }, (err) => {
        chosen.usage.inflight -= 1;

        if (err && err.code === 'ETOKENEXHAUSTED') {
            return dealToken(tokens, fn, options);
        }

        throw err;
    });
}

// ----------------------------------------------------

function tokenDealer(tokens, fn, options) {
    if (!tokens || !tokens.length) {
        tokens = [''];
    }

    options = {
        group: 'default',
        wait: false,
        lru: defaultLru,
        onExhausted: null,
        ...options,
    };

    return dealToken(tokens, fn, options);
}

function getTokensUsage(tokens, options) {
    if (!tokens || !tokens.length) {
        tokens = [''];
    }

    options = {
        group: 'default',
        lru: defaultLru,
        ...options,
    };

    const tokensUsage = {};

    tokens.forEach((token) => {
        tokensUsage[token] = retrieveTokenUsage(token, options);
    });

    return tokensUsage;
}

module.exports = tokenDealer;
module.exports.getTokensUsage = getTokensUsage;
module.exports.defaultLru = defaultLru;
