const express = require("express");
const path = require("path");
const fs = require("fs");
const { createServer } = require("http");

// Packages for handling authentication
const argon2 = require("argon2");
const session = require("express-session");

// Package for the web socket connection
const { Server } = require("socket.io");

const { createLobby } = require("./lobby");
const { createGame } = require("./game");

// Where things live (independent of the directory the server is started from)
const USERS_FILE = path.join(__dirname, "data", "users.json");
const PUBLIC_DIR = path.join(__dirname, "public");

// How often the server advances the game and sends the state to the players
const TICK_MS = 33;

// Create the Express app
const app = express();

// Use the 'public' folder to serve static files
app.use(express.static(PUBLIC_DIR));

// Use the json middleware to parse JSON data
app.use(express.json());

// Use the session middleware to maintain sessions
const gameSession = session({
    secret: "game",
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { maxAge: 300000 }
});
app.use(gameSession);

// Helpers for the user accounts: { username: { password, wins, losses } }
function readUsers() {
    return JSON.parse(fs.readFileSync(USERS_FILE));
}

function writeUsers(users) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// The part of an account that the browser may see
function publicUser(username, account) {
    return { username, wins: account.wins || 0, losses: account.losses || 0 };
}

// Score calculation
function wilsonScoreLowerBound(wins, losses, z = 1.96) {
  const total = wins + losses;
  if (total <= 0) return 0;

  const p = wins / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const center = p + z2 / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total);

  return (center - margin) / denominator;
}

// Top 3 players
function getTopThreePlayers(z = 1.96) {
  const users = readUsers();

  return Object.entries(users)
    .map(([username, stats]) => {
      const wins = Number(stats.wins) || 0;
      const losses = Number(stats.losses) || 0;
      const totalGames = wins + losses;
      const score = wilsonScoreLowerBound(wins, losses, z);

      return {
        username,
        wins,
        losses,
        totalGames,
        winRate: totalGames > 0 ? wins / totalGames : 0,
        wilsonScore: score,
      };
    })
    .filter((player) => player.totalGames > 0)
    .sort((a, b) => b.wilsonScore - a.wilsonScore || b.wins - a.wins)
    .slice(0, 3);
}

// Store the result of a game; returns the new records of both players
function recordResult(winner, loser) {
    const users = readUsers();
    users[winner].wins = (users[winner].wins || 0) + 1;
    users[loser].losses = (users[loser].losses || 0) + 1;
    writeUsers(users);
    return {
        [winner]: publicUser(winner, users[winner]),
        [loser]: publicUser(loser, users[loser])
    };
}

function containWordCharsOnly(text) {
    return /^\w+$/.test(text);
}

function isNonEmptyString(value) {
    return typeof value === "string" && value !== "";
}

// Handle the /register endpoint
app.post("/register", async (req, res) => {
    const { username, password } = req.body || {};

    if (![username, password].every(isNonEmptyString)) {
        res.json({ error: "Username/password cannot be empty." });
        return;
    }
    if (!containWordCharsOnly(username)) {
        res.json({ error: "Username can only contain underscores, letters or numbers." });
        return;
    }
    if (username.length > 10) {
        res.json({ error: "Username is too long." });
        return;
    }

    const users = readUsers();
    if (Object.hasOwn(users, username)) {
        res.json({ error: "Username already registered." });
        return;
    }

    // Hash the password and save the new account with an empty record
    const hash = await argon2.hash(password);
    users[username] = { password: hash, wins: 0, losses: 0 };
    writeUsers(users);

    res.json({ success: true });
});

// Handle the /signin endpoint
app.post("/signin", async (req, res) => {
    const { username, password } = req.body || {};

    const users = readUsers();
    if (!isNonEmptyString(username) || !isNonEmptyString(password) ||
        !Object.hasOwn(users, username)) {
        res.json({ error: "Incorrect username/password." });
        return;
    }

    const user = users[username];
    const verified = await argon2.verify(user.password, password);
    if (!verified) {
        res.json({ error: "Incorrect username/password." });
        return;
    }

    req.session.user = { username };
    res.json({ user: publicUser(username, user) });
});

// Handle the /validate endpoint
app.get("/validate", (req, res) => {
    if (!req.session || !req.session.user) {
        res.json({ error: "Not signed in." });
        return;
    }

    // Read the record from the file so that it is always up to date
    const { username } = req.session.user;
    const users = readUsers();
    if (!Object.hasOwn(users, username)) {
        res.json({ error: "Not signed in." });
        return;
    }
    res.json({ user: publicUser(username, users[username]) });
});

// Handle the /signout endpoint
app.get("/signout", (req, res) => {
    const user = req.session && req.session.user;
    if (user) {
        delete req.session.user;

        // A signed out user must not stay in the lobby
        for (const socket of io.sockets.sockets.values()) {
            if (socket.data.user && socket.data.user.username === user.username)
                socket.disconnect(true);
        }
    }
    res.json({ success: true });
});

const httpServer = createServer(app);
const io = new Server(httpServer);

// Share the Express session with Socket.IO, and only let signed in users connect
io.engine.use(gameSession);
io.use((socket, next) => {
    const user = socket.request.session && socket.request.session.user;
    if (!user) {
        next(new Error("Please sign in first."));
        return;
    }
    socket.data.user = user;
    next();
});

const lobby = createLobby();
let game = null;
let gameStartedAt = 0;
let gameLoop = null;
let lastStateJson = "";

const broadcastPlayers = () => io.to("lobby").emit("update_players", lobby.snapshot());

// Send the positions to the players (only when something changed)
const broadcastState = () => {
    const state = game.state();
    const json = JSON.stringify(state);
    if (json === lastStateJson) return;
    lastStateJson = json;
    io.to("lobby").emit("game_state", state);
};

// Tell the players what happened in the game (fireball thrown / ended) so they can hear it
const broadcastEvents = () => {
    for (const event of game.drainEvents()) io.to("lobby").emit("game_event", event);
};

const stopGame = () => {
    clearInterval(gameLoop);
    gameLoop = null;
    game = null;
    lastStateJson = "";
};

const startGame = () => {
    game = createGame(lobby.snapshot().map(({ username, sprite }) => ({ username, sprite })));
    lastStateJson = "";
    gameStartedAt = Date.now();
    io.to("lobby").emit("game_start", game.init());
    broadcastState();

    // Echo walks around and held keys move the players, so keep ticking
    gameLoop = setInterval(() => {
        const result = game.tick();
        broadcastEvents();
        broadcastState();
        if (result) endGame(result);
    }, TICK_MS);
};

// The game is over ({ winner, loser, reason }): store the result and tell the browsers
const endGame = (result) => {
    broadcastState();
    const elapsedMs = Date.now() - gameStartedAt;
    const records = recordResult(result.winner, result.loser);

    stopGame();
    lobby.finish(records);
    io.to("lobby").emit("game_end", { ...result, elapsedMs, players: lobby.snapshot(), leaderboard: getTopThreePlayers() });
    broadcastPlayers();
};

io.on("connection", (socket) => {
    const user = socket.data.user;
    console.log("Player connected:", user.username);

    // Wait for the player to join the lobby
    socket.on("join", () => {
        const users = readUsers();
        if (!Object.hasOwn(users, user.username)) {
            socket.emit("join_error", "Your account no longer exists.");
            return;
        }

        const result = lobby.join(socket.id, publicUser(user.username, users[user.username]));
        if (result.error) {
            socket.emit("join_error", result.error);
            return;
        }

        socket.join("lobby");
        socket.emit("join_success");
        broadcastPlayers();

        console.log("Current players -", lobby.snapshot()); // DON'T DELETE - FOR MARKING
    });

    // Wait for the player to get ready; the game starts when both players are ready
    socket.on("ready", () => {
        const { started } = lobby.ready(socket.id);
        broadcastPlayers();
        if (started) startGame();

        console.log("Current players -", lobby.snapshot()); // DON'T DELETE - FOR MARKING
    });

    // A key was pressed/released: { dir: "up"|"down"|"left"|"right", held: boolean }
    socket.on("input", (data) => {
        if (!game || !data) return;
        const result = game.input(user.username, data.dir, data.held === true);
        broadcastEvents();
        if (result) endGame(result);
    });

    // Shift was pressed: shoot a fireball
    socket.on("shoot", () => {
        if (!game) return;
        const result = game.shoot(user.username);
        broadcastEvents();
        if (result) endGame(result);
    });

    // A player leaves, signs out or gets disconnected
    const leave = () => {
        const { cancelled } = lobby.leave(socket.id);
        socket.leave("lobby");

        if (cancelled) {
            stopGame();
            io.to("lobby").emit("game_cancelled", `${user.username} left the game.`);
        }
        broadcastPlayers();
    };
    socket.on("leave", leave);
    socket.on("disconnect", leave);
});

if (require.main === module) {
    httpServer.listen(8000, () => {
        console.log("The game server has started...");
    });
}

module.exports = { httpServer };
