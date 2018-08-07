'use strict';

const delay = require('delay');
const LRU = require('lru-cache');
const tokenDealer = require('../');

describe('token-dealer', () => {
    let lru;

    beforeEach(() => {
        lru = new LRU();
    });

    it('should return an empty token if no tokens were passed', async () => {
        let suppliedToken;

        await tokenDealer(null, (token) => {
            suppliedToken = token;
        }, { lru });

        expect(suppliedToken).toBe('');

        await tokenDealer([], (token) => {
            suppliedToken = token;
        }, { lru });

        expect(suppliedToken).toBe('');
    });

    it('should still be able to call exhaust() if no tokens were supplied', async () => {
        expect.assertions(2);

        try {
            await tokenDealer(null, (token, exhaust) => {
                exhaust(Date.now() + 2000, true);
            }, { lru });
        } catch (err) {
            expect(err).toBeInstanceOf(Error);
            expect(err.code).toBe('EALLTOKENSEXHAUSTED');
        }
    });

    it('should deal tokens, putting aside exhausted ones', async () => {
        const tokens = ['A', 'B', 'C', 'D'];
        const suppliedTokens = [];

        // Should give A followed by B
        await tokenDealer(tokens, (token, exhaust) => {
            suppliedTokens.push(token);

            return delay(50)
            .then(() => {
                if (token === 'A') {
                    exhaust(Date.now() + 2000, true);
                }
            });
        }, { lru });

        expect(suppliedTokens).toEqual(['A', 'B']);

        // Should give B since A is exhausted
        await tokenDealer(tokens, (token) => {
            suppliedTokens.push(token);
        }, { lru });

        expect(suppliedTokens).toEqual(['A', 'B', 'B']);

        // Should give B since A is exhausted
        await tokenDealer(tokens, async (token, exhaust) => {
            suppliedTokens.push(token);

            await delay(50);
            exhaust(Date.now() + 1000);
        }, { lru });

        expect(suppliedTokens).toEqual(['A', 'B', 'B', 'B']);

        // Should give C since A and B is exhausted
        await tokenDealer(tokens, async (token) => {
            suppliedTokens.push(token);

            await delay(50);
        }, { lru });

        expect(suppliedTokens).toEqual(['A', 'B', 'B', 'B', 'C']);

        // Should give C since A and B is exhausted
        await tokenDealer(tokens, async (token) => {
            suppliedTokens.push(token);

            await delay(50);
        }, { lru });

        expect(suppliedTokens).toEqual(['A', 'B', 'B', 'B', 'C', 'C']);

        // Should give C since A and B is exhausted
        await tokenDealer(tokens, async (token, exhaust) => {
            suppliedTokens.push(token);

            await delay(1100);
            exhaust(Date.now() + 3000);
        }, { lru });

        expect(suppliedTokens).toEqual(['A', 'B', 'B', 'B', 'C', 'C', 'C']);

        // Should give B, since it is no longer exhausted because enough time has passed
        await tokenDealer(tokens, (token) => {
            suppliedTokens.push(token);
        }, { lru });

        expect(suppliedTokens).toEqual(['A', 'B', 'B', 'B', 'C', 'C', 'C', 'B']);
        await delay(1100);

        // Should give A, since it is no longer exhausted because enough time has passed
        await tokenDealer(tokens, (token) => {
            suppliedTokens.push(token);
        }, { lru });

        expect(suppliedTokens).toEqual(['A', 'B', 'B', 'B', 'C', 'C', 'C', 'B', 'A']);
    });

    it('should deal tokens, giving less priority to the ones with higher inflight count', async () => {
        const tokens = ['A', 'B', 'C'];
        const suppliedTokens = [];

        const fn = async (token) => {
            suppliedTokens.push(token);
            await delay(50);
        };

        await Promise.all([
            tokenDealer(tokens, fn, { lru }),
            tokenDealer(tokens, fn, { lru }),
            tokenDealer(tokens, fn, { lru }),
            tokenDealer(tokens, fn, { lru }),
            tokenDealer(tokens, fn, { lru }),
            tokenDealer(tokens, fn, { lru }),
        ]);

        expect(suppliedTokens).toEqual(['A', 'B', 'C', 'A', 'B', 'C']);
    });

    it('should call options.onExhausted when a token become exhausted', async () => {
        expect.assertions(6);

        const resetTimestamp = Date.now() + 2000;
        const onExhausted = jest.fn();

        // Test if it's called
        try {
            await tokenDealer(['A'], (token, exhaust) => {
                exhaust(resetTimestamp, true);
            }, { lru, onExhausted });
        } catch (err) {
            expect(err).toBeInstanceOf(Error);
            expect(err.code).toBe('EALLTOKENSEXHAUSTED');
        }

        // Try again, but this time it shouldn't be called because it's already exhausted
        try {
            await tokenDealer(['A'], () => {}, { lru, onExhausted });
        } catch (err) {
            expect(err).toBeInstanceOf(Error);
            expect(err.code).toBe('EALLTOKENSEXHAUSTED');
        }

        expect(onExhausted).toHaveBeenCalledTimes(1);
        expect(onExhausted).toHaveBeenCalledWith('A', resetTimestamp);
    });

    it('should isolate tokens by groups', async () => {
        const tokens = ['A', 'B', 'C'];
        const suppliedTokens = [];

        // Should give A
        await tokenDealer(tokens, async (token, exhaust) => {
            suppliedTokens.push(token);

            await delay(50);
            exhaust(Date.now() + 1000);
        }, { lru });

        expect(suppliedTokens).toEqual(['A']);

        // Should give A because the group is different
        await tokenDealer(tokens, (token) => {
            suppliedTokens.push(token);
        }, { group: 'foo', lru });

        expect(suppliedTokens).toEqual(['A', 'A']);
    });

    it('should fail if all tokens are exhausted', async () => {
        expect.assertions(7);

        const tokens = ['A', 'B'];
        const suppliedTokens = [];
        const resetTimestamps = [];

        // Should give A followed by B and then fail
        try {
            await tokenDealer(tokens, async (token, exhaust) => {
                suppliedTokens.push(token);

                await delay(50);

                resetTimestamps.push(Date.now() + 1000);
                exhaust(resetTimestamps[resetTimestamps.length - 1], true);
            }, { lru });
        } catch (err) {
            expect(err).toBeInstanceOf(Error);
            expect(err.code).toBe('EALLTOKENSEXHAUSTED');
            expect(err.usage).toEqual({
                A: { exhausted: true, reset: resetTimestamps[0], inflight: 0 },
                B: { exhausted: true, reset: resetTimestamps[1], inflight: 0 },
            });
        }

        expect(suppliedTokens).toEqual(['A', 'B']);

        // Should fail immediately
        try {
            await tokenDealer(tokens, (token) => {
                suppliedTokens.push(token);
            }, { lru });
        } catch (err) {
            expect(err).toBeInstanceOf(Error);
            expect(err.code).toBe('EALLTOKENSEXHAUSTED');
        }

        expect(suppliedTokens).toEqual(['A', 'B']);
    });

    it('should not re-deal tokens if exhaust is called with fail != true', async () => {
        expect.assertions(3);

        const tokens = ['A', 'B'];
        const suppliedTokens = [];

        // Should give A and then fail
        try {
            await tokenDealer(tokens, async (token, exhaust) => {
                suppliedTokens.push(token);

                await delay(50);
                exhaust(Date.now() + 1000);
                throw new Error('foo');
            }, { lru });
        } catch (err) {
            expect(err).toBeInstanceOf(Error);
            expect(err.message).toBe('foo');
        }

        expect(suppliedTokens).toEqual(['A']);
    });

    it('should decrease inflight if fn fails synchronously', async () => {
        expect.assertions(4);

        const tokens = ['A', 'B'];
        const suppliedTokens = [];

        try {
            await tokenDealer(tokens, (token) => {
                suppliedTokens.push(token);
                throw new Error('foo');
            }, { lru });
        } catch (err) {
            expect(err).toBeInstanceOf(Error);
            expect(err.message).toBe('foo');
        }

        expect(suppliedTokens).toEqual(['A']);
        expect(tokenDealer.getTokensUsage(tokens, { lru })).toEqual({
            A: { exhausted: false, reset: null, inflight: 0 },
            B: { exhausted: false, reset: null, inflight: 0 },
        });
    });

    it('should wait if all tokens are exhausted when options.wait is true', async () => {
        const tokens = ['A'];
        const suppliedTokens = [];

        // Should give A
        await tokenDealer(tokens, (token, exhaust) => {
            suppliedTokens.push(token);

            return delay(50)
            .then(() => exhaust(Date.now() + 2500));
        }, { lru });

        expect(suppliedTokens).toEqual(['A']);

        // Should still give A, but wait 2.5sec
        const timeBefore = Date.now();

        await tokenDealer(tokens, (token) => {
            suppliedTokens.push(token);
        }, { lru, wait: true });

        expect(suppliedTokens).toEqual(['A', 'A']);
        expect(Date.now() - timeBefore).toBeGreaterThanOrEqual(2400, 3000);
        expect(Date.now() - timeBefore).toBeLessThanOrEqual(3000);
    });

    it('should call wait function whenever waiting', async () => {
        const tokens = ['A'];
        const suppliedTokens = [];
        const waitDelays = [];
        const wait = (token, delay) => {
            expect(tokens.indexOf(token)).not.toBe(-1);
            waitDelays.push(delay);

            return true;
        };

        // Should give A
        await tokenDealer(tokens, async (token, exhaust) => {
            suppliedTokens.push(token);

            await delay(50);
            exhaust(Date.now() + 600);
        }, { lru, wait });

        expect(suppliedTokens).toEqual(['A']);

        // Should still give A, but wait
        const timeBefore = Date.now();

        await tokenDealer(tokens, (token) => {
            suppliedTokens.push(token);
        }, { lru, wait });

        expect(suppliedTokens).toEqual(['A', 'A']);
        expect(Date.now() - timeBefore).toBeGreaterThanOrEqual(500);
        expect(Date.now() - timeBefore).toBeLessThanOrEqual(1200);

        expect(waitDelays.length).toBe(1);
        expect(waitDelays[0]).toBeGreaterThanOrEqual(500);
        expect(waitDelays[0]).toBeLessThanOrEqual(1200);
    });

    it('should use the passed LRU', async () => {
        const tokens = ['A'];
        const suppliedTokens = [];

        // Should give A
        await tokenDealer(tokens, async (token, exhaust) => {
            suppliedTokens.push(token);

            await delay(50);
            exhaust(Date.now() + 1000);
        }, { lru });

        expect(suppliedTokens).toEqual(['A']);

        // Should still give A since another LRU was passed
        await tokenDealer(tokens, (token) => {
            suppliedTokens.push(token);
        }, { lru: new LRU() });

        expect(suppliedTokens).toEqual(['A', 'A']);
    });

    describe('.getTokensUsage()', () => {
        it('should give the current tokens usage', () => {
            expect(tokenDealer.getTokensUsage(['A', 'B'], { lru })).toEqual({
                A: { exhausted: false, reset: null, inflight: 0 },
                B: { exhausted: false, reset: null, inflight: 0 },
            });

            expect(tokenDealer.getTokensUsage([], { lru })).toEqual({
                '': { exhausted: false, reset: null, inflight: 0 },
            });
        });
    });

    describe('.defaultLru', () => {
        it('should be the default lru', () => {
            expect(tokenDealer.defaultLru).toBeTruthy();
        });
    });
});
