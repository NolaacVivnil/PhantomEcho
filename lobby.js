const MAX_PLAYERS = 2;

function createLobby(random = Math.random) {
    // key: socket id -> { username, sprite, wins, losses, ready }
    const players = new Map();
    let playing = false;

    const join = (id, user) => {
        if (players.has(id)) return { error: "You are already in the lobby." };
        for (const p of players.values()) {
            if (p.username === user.username)
                return { error: "You are already in the lobby from another tab." };
        }
        if (playing) return { error: "A game is in progress. Please try again later." };
        if (players.size >= MAX_PLAYERS) return { error: "The lobby is full." };

        const taken = [...players.values()].map((p) => p.sprite);
        const free = [1, 2].filter((n) => !taken.includes(n));

        players.set(id, {
            username: user.username,
            sprite: free[Math.floor(random() * free.length)],
            wins: user.wins || 0,
            losses: user.losses || 0,
            ready: false
        });
        return { ok: true };
    };

    const ready = (id) => {
        const p = players.get(id);
        if (!p || playing) return { started: false };
        p.ready = true;

        if (players.size === MAX_PLAYERS && [...players.values()].every((x) => x.ready)) {
            playing = true;
            return { started: true };
        }
        return { started: false };
    };

    const finish = (records = {}) => {
        if (!playing) return false;
        playing = false;
        for (const p of players.values()) {
            p.ready = false;
            const record = records[p.username];
            if (record) {
                p.wins = record.wins;
                p.losses = record.losses;
            }
        }
        return true;
    };

    const leave = (id) => {
        if (!players.delete(id)) return { cancelled: false };
        const cancelled = playing;
        if (cancelled) {
            playing = false;
            for (const p of players.values()) p.ready = false;
        }
        return { cancelled };
    };

    const snapshot = () =>
        [...players.values()].map(({ username, sprite, wins, losses, ready }) => ({
            username, sprite, wins, losses, ready
        }));

    return { join, ready, finish, leave, snapshot, isPlaying: () => playing };
}

module.exports = { createLobby, MAX_PLAYERS };
