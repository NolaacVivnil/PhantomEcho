const { generateMaze, SIZE, FLOOR } = require("./maze");

const MOVE_MS = 160;          // a held key moves a player one tile this often
const TURN_DELAY_MS = 130;    // after turning, the key must be held this long before moving
const ECHO_MS = 420;          // Echo moves one tile this often
const PHANTOM_MS = 1200;      // a wandering Phantom
const PHANTOM_CHASE_MS = 420; // a Phantom that is locked onto a player
const FIREBALL_MS = 55;       // fireballs are much faster than everybody else
const MOVING_FLAG_MS = MOVE_MS + 90; // how long "moving" (sprite animation) lasts after a step

const SIGHT = 5;              // how far a Phantom sees straight ahead
const PHANTOM_COUNT = 4;
const MAX_FIREBALLS = 3;

const DIRS = {
    down: [0, 1],
    left: [-1, 0],
    right: [1, 0],
    up: [0, -1]
};
const DIR_NAMES = Object.keys(DIRS);
const OPPOSITE = { down: "up", up: "down", left: "right", right: "left" };

function createGame(playerInfos, { random = Math.random, now = Date.now() } = {}) {
    const maze = generateMaze(random);
    const mid = (SIZE - 1) / 2;
    const randInt = (n) => Math.floor(random() * n);

    const corners = random() < 0.5
        ? [[1, 1], [SIZE - 2, SIZE - 2]]
        : [[SIZE - 2, 1], [1, SIZE - 2]];
    if (random() < 0.5) corners.reverse();

    const players = playerInfos.map(({ username, sprite }, i) => ({
        username,
        sprite,
        x: corners[i][0],
        y: corners[i][1],
        dir: "down",
        held: false,
        turnedAt: now,
        lastMove: -Infinity,
        shots: 0
    }));

    const echo = { x: mid, y: mid, dir: DIR_NAMES[randInt(4)], lastMove: now, alive: true };

    const fireballs = [];
    let nextFireballId = 0;
    let result = null;

    const isFloor = (x, y) => maze[y] !== undefined && maze[y][x] === FLOOR;
    const playerAt = (x, y, except) =>
        players.find((p) => p !== except && p.x === x && p.y === y);
    const otherPlayer = (p) => players.find((q) => q !== p);

    const events = [];
    const endFireball = (f, on) => {
        if (f.dead) return;
        f.dead = true;
        events.push({ type: "fireball_end", on });   // on: "wall" | "player" | "echo" | "phantom"
    };

    const finish = (r) => {
        result = r;
        return r;
    };

    const distanceMap = (sx, sy) => {
        const d = Array.from({ length: SIZE }, () => Array(SIZE).fill(Infinity));
        d[sy][sx] = 0;
        const queue = [[sx, sy]];
        for (let i = 0; i < queue.length; i++) {
            const [x, y] = queue[i];
            for (const [dx, dy] of Object.values(DIRS)) {
                const nx = x + dx;
                const ny = y + dy;
                if (isFloor(nx, ny) && d[ny][nx] === Infinity) {
                    d[ny][nx] = d[y][x] + 1;
                    queue.push([nx, ny]);
                }
            }
        }
        return d;
    };

    const phantoms = [];
    {
        const floors = [];
        for (let y = 1; y < SIZE - 1; y++) {
            for (let x = 1; x < SIZE - 1; x++) {
                if (maze[y][x] === FLOOR) floors.push([x, y]);
            }
        }
        const far = (x, y, ox, oy, d) => Math.abs(x - ox) + Math.abs(y - oy) >= d;
        const playerDistanceMaps = players.map(p => distanceMap(p.x, p.y));
        const isEquallyDistant = (x, y) => {
            if (players.length === 0) return false;
            const firstDist = playerDistanceMaps[0][y][x];
            if (firstDist === Infinity) return false;
            return playerDistanceMaps.every(map => map[y][x] === firstDist);
        };
        const equidistantFloors = floors.filter(([x, y]) => isEquallyDistant(x, y));
        const candidateFloors = equidistantFloors.length > 0 ? equidistantFloors : floors;
        while (phantoms.length < PHANTOM_COUNT) {
            const options = candidateFloors.filter(([x, y]) =>
                phantoms.every(q => q.x !== x || q.y !== y) &&
                far(x, y, echo.x, echo.y, 3)
            );
            if (options.length === 0) break;
            const [x, y] = options[randInt(options.length)];
            phantoms.push({
                id: phantoms.length + 1,
                x,
                y,
                dir: DIR_NAMES[randInt(4)],
                lastMove: now,
                target: null
            });
        }
    }

    const collide = () => {
        // Fireballs: they hurt everybody except the player who shot them
        for (const f of fireballs) {
            if (f.dead) continue;

            const victim = players.find((p) => p !== f.owner && p.x === f.x && p.y === f.y);
            if (victim) {
                endFireball(f, "player");
                return finish({ winner: f.owner.username, loser: victim.username, reason: "fireball" });
            }
            if (echo.alive && echo.x === f.x && echo.y === f.y) {
                endFireball(f, "echo");
                echo.alive = false;
                return finish({
                    winner: otherPlayer(f.owner).username,
                    loser: f.owner.username,
                    reason: "echo_killed"
                });
            }
            for (let i = phantoms.length - 1; i >= 0; i--) {
                if (phantoms[i].x === f.x && phantoms[i].y === f.y) {
                    phantoms.splice(i, 1);
                    endFireball(f, "phantom");
                }
            }
        }

        // A Phantom touches a player: that player loses.
        for (const p of players) {
            if (phantoms.some((ph) => ph.x === p.x && ph.y === p.y))
                return finish({ winner: otherPlayer(p).username, loser: p.username, reason: "phantom" });
        }

        // A player steps on Echo: that player wins
        if (echo.alive) {
            for (const p of players) {
                if (p.x === echo.x && p.y === echo.y)
                    return finish({ winner: p.username, loser: otherPlayer(p).username, reason: "echo" });
            }
        }
        return null;
    };

    // Try to move the player one tile
    const step = (p, t) => {
        const [dx, dy] = DIRS[p.dir];
        const nx = p.x + dx;
        const ny = p.y + dy;
        if (!isFloor(nx, ny) || playerAt(nx, ny, p)) return false;

        p.x = nx;
        p.y = ny;
        p.lastMove = t;
        return true;
    };

    const canMove = (p, t) =>
        p.held && t - p.turnedAt >= TURN_DELAY_MS && t - p.lastMove >= MOVE_MS;

    const input = (username, dir, held, t = Date.now()) => {
        if (result) return result;
        const p = players.find((q) => q.username === username);
        if (!p || !(dir in DIRS)) return null;

        if (dir !== p.dir) {
            // First press only turns the player
            p.dir = dir;
            p.turnedAt = t;
        }
        p.held = !!held;

        // Pressing the key while already facing that way moves right away
        if (canMove(p, t) && step(p, t)) return collide();
        return null;
    };

    const shoot = (username, t = Date.now()) => {
        if (result) return result;
        const p = players.find((q) => q.username === username);
        if (!p || p.shots >= MAX_FIREBALLS) return null;

        p.shots++;
        fireballs.push({
            id: ++nextFireballId, x: p.x, y: p.y, dir: p.dir, owner: p, lastMove: t, dead: false
        });
        events.push({ type: "fireball_throw" });
        return null;
    };

    const wander = (e, avoidPlayers) => {
        const open = DIR_NAMES.filter((d) => {
            const nx = e.x + DIRS[d][0];
            const ny = e.y + DIRS[d][1];
            return isFloor(nx, ny) && !(avoidPlayers && playerAt(nx, ny));
        });
        if (!open.length) return;

        let choices = open.filter((d) => d !== OPPOSITE[e.dir]);
        if (!choices.length) choices = open;
        e.dir = choices.includes(e.dir) && random() < 0.7
            ? e.dir
            : choices[randInt(choices.length)];
        e.x += DIRS[e.dir][0];
        e.y += DIRS[e.dir][1];
    };

    const sees = (ph, p) => {
        const [dx, dy] = DIRS[ph.dir];
        for (let i = 1; i <= SIGHT; i++) {
            const x = ph.x + dx * i;
            const y = ph.y + dy * i;
            if (!isFloor(x, y)) return false;
            if (p.x === x && p.y === y) return true;
        }
        return false;
    };

    const tick = (t = Date.now()) => {
        if (result) return result;

        // Held keys move the players
        for (const p of players) {
            if (canMove(p, t) && step(p, t)) {
                const r = collide();
                if (r) return r;
            }
        }

        // Fireballs fly fast: several tiles per tick if needed
        for (const f of fireballs) {
            while (!f.dead && t - f.lastMove >= FIREBALL_MS) {
                f.lastMove += FIREBALL_MS;
                const nx = f.x + DIRS[f.dir][0];
                const ny = f.y + DIRS[f.dir][1];
                if (!isFloor(nx, ny)) {
                    endFireball(f, "wall");     // it would hit a wall
                    break;
                }
                f.x = nx;
                f.y = ny;
                const r = collide();
                if (r) return r;
            }
        }
        for (let i = fireballs.length - 1; i >= 0; i--) {
            if (fireballs[i].dead) fireballs.splice(i, 1);
        }

        // Phantoms: spot players, lock onto the closest one, and chase or wander
        if (phantoms.length) {
            const distanceTo = {};
            for (const p of players) distanceTo[p.username] = distanceMap(p.x, p.y);

            for (const ph of [...phantoms]) {
                const seen = players
                    .filter((p) => sees(ph, p))
                    .sort((a, b) => distanceTo[a.username][ph.y][ph.x] - distanceTo[b.username][ph.y][ph.x]);
                if (seen.length) {
                    const best = seen[0].username;
                    if (!ph.target ||
                        (best !== ph.target &&
                         distanceTo[best][ph.y][ph.x] < distanceTo[ph.target][ph.y][ph.x]))
                        ph.target = best;
                }

                if (t - ph.lastMove < (ph.target ? PHANTOM_CHASE_MS : PHANTOM_MS)) continue;
                ph.lastMove = t;

                if (ph.target) {
                    // Take the step that gets closest to the player
                    const d = distanceTo[ph.target];
                    let best = null;
                    for (const dir of DIR_NAMES) {
                        const nx = ph.x + DIRS[dir][0];
                        const ny = ph.y + DIRS[dir][1];
                        if (isFloor(nx, ny) && d[ny][nx] < d[ph.y][ph.x] &&
                            (!best || d[ny][nx] < best.d)) best = { dir, d: d[ny][nx] };
                    }
                    if (best) {
                        ph.dir = best.dir;
                        ph.x += DIRS[best.dir][0];
                        ph.y += DIRS[best.dir][1];
                    }
                } else {
                    wander(ph, false);
                }
                const r = collide();
                if (r) return r;
            }
        }

        // Echo wanders (and never walks onto a player: only a player stepping on Echo counts)
        if (echo.alive && t - echo.lastMove >= ECHO_MS) {
            echo.lastMove = t;
            wander(echo, true);
            const r = collide();
            if (r) return r;
        }

        return collide();
    };

    // What the clients need once, when the game starts
    const init = () => ({
        maze: maze.map((row) => row.join("")),
        players: players.map(({ username, sprite }) => ({ username, sprite }))
    });

    // What the clients need all the time
    const state = (t = Date.now()) => ({
        players: players.map((p) => ({
            username: p.username,
            x: p.x,
            y: p.y,
            dir: p.dir,
            moving: t - p.lastMove < MOVING_FLAG_MS,
            shots: MAX_FIREBALLS - p.shots      // fireballs left
        })),
        echo: {
            x: echo.x,
            y: echo.y,
            dir: echo.dir,
            alive: echo.alive,
            moving: t - echo.lastMove < MOVING_FLAG_MS
        },
        phantoms: phantoms.map((ph) => ({
            id: ph.id,
            x: ph.x,
            y: ph.y,
            dir: ph.dir,
            moving: t - ph.lastMove < MOVING_FLAG_MS
        })),
        fireballs: fireballs.map((f) => ({ id: f.id, x: f.x, y: f.y, dir: f.dir }))
    });

    // The events since the last call (and forget them)
    const drainEvents = () => events.splice(0);

    return { init, input, shoot, tick, state, drainEvents, maze, players, echo, phantoms, fireballs };
}

module.exports = {
    createGame, MOVE_MS, TURN_DELAY_MS, ECHO_MS, FIREBALL_MS, PHANTOM_COUNT, MAX_FIREBALLS, SIGHT
};
