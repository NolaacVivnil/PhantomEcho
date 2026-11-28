const MazeGame = (function() {
    const TILE_SRC = 64;      // size of a tile / sprite in the image files
    const SIZE = 31;          // the whole maze is 31 x 31 tiles
    const VIEW = 11;          // playing: screen shows 11 x 11 tiles around

    const SPRITE_ROW = { down: 0, left: 1, right: 2, up: 3 };
    const WALK_FRAMES = 3;    // columns 1..3
    const FRAME_MS = 110;     // how long each walking frame is shown
    const FIRE_FRAME_MS = 70; // fireballs cycle through all 4 columns

    const KEYS = {
        w: "up", arrowup: "up",
        s: "down", arrowdown: "down",
        a: "left", arrowleft: "left",
        d: "right", arrowright: "right"
    };

    const images = {};
    for (const name of ["wall", "floor", "spritesheet-player-1", "spritesheet-player-2",
                        "spritesheet-echo", "spritesheet-phantom", "spritesheet-fireball"]) {
        images[name] = new Image();
        images[name].src = `images/${name}.png`;
    }
    const ready = (img) => img.complete && img.naturalWidth > 0;

    let socket = null;
    let user = null;
    let phase = "lobby";          // "lobby" | "playing" | "over"
    let cheating = false;
    let inLobby = false;
    let lastPlayers = [];         // latest lobby players (with sprites and records)
    let maze = null;              // array of strings, "1" = wall, "0" = floor
    let spriteOf = {};            // username -> 1 or 2
    let current = null;           // latest state from the server
    let heldKeys = [];            // directions currently held, most recent last
    let animating = false;
    let startedAt = 0;            // when the game started (for the timer)
    let shownSeconds = -1;        // what the timer currently shows

    const canvas = () => $("#maze-canvas").get(0);
    const isWall = (x, y) => maze[y][x] === "1";

    const showPage = function(id) {
        $("#game-room-area > div").hide();
        $(id).show();
    };

    const updatePlayers = function(players) {
        for (let i = 0; i < 2; i++) {
            const slot = $("#player" + (i + 1));
            const player = players[i];
            const avatar = slot.find(".avatar").removeClass("sprite-1 sprite-2");

            slot.removeClass("empty");
            if (!player) {
                slot.addClass("empty");
                avatar.text("?");
                slot.find(".name").text("");
                slot.find(".record").text("");
                slot.find(".status").text("Waiting for a player...");
                continue;
            }

            const isYou = player.username == user.username;
            avatar.text("").addClass("sprite-" + player.sprite);
            slot.find(".name").text(isYou ? `${player.username} (you)` : player.username);
            slot.find(".record").text(`Wins: ${player.wins} · Losses: ${player.losses}`);
            slot.find(".status").text(`${isYou ? "You are" : player.username + " is"} ${player.ready ? "ready!" : "not yet ready..."}`);
        }
    };

    // Messages on the lobby page and the game-over overlay that depend on who is ready
    const updateWaiting = function() {
        const me = lastPlayers.find((p) => p.username == user.username);
        const other = lastPlayers.find((p) => p.username != user.username);

        if (phase === "lobby") {
            if (me && me.ready) {
                $("#ready-button").hide();
                $("#game-message").text(!other
                    ? "Waiting for another player to join..."
                    : "Waiting for the other player to get ready...");
            } else if (me) {
                $("#ready-button").show();
            }
        } else if (phase === "over") {
            $("#game-over-note").text(!other
                ? "Your opponent has left the lobby."
                : other.ready ? `${other.username} is ready for another game!` : "");
        }
    };

    // Go back to the "Hello" page
    const exitLobby = function(message) {
        const wasInLobby = inLobby;
        inLobby = false;
        phase = "lobby";
        animating = false;
        heldKeys = [];
        Sound.stopMusic();
        $("#game-hud").hide();
        $("#game-over-overlay").hide();
        if (socket) {
            // Clear the variable first: disconnect() fires the "disconnect" event
            const old = socket;
            socket = null;
            old.disconnect();
        }
        $("#content-message").text(message || "");
        $("#join-lobby-button").prop("disabled", false);
        showPage("#game-room-content-page");

        // Wins and losses may have changed
        if (wasInLobby) GameRoom.refresh();
    };

    const backToLobbyPage = function() {
        phase = "lobby";
        animating = false;
        heldKeys = [];
        Sound.stopMusic();
        $("#game-hud").hide();
        $("#game-over-overlay").hide();
        showPage("#game-room-lobby-page");
    };


    const formatTime = function(ms) {
        const total = Math.max(0, Math.floor(ms / 1000));
        const pad = (n) => String(n).padStart(2, "0");
        return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
    };

    const updateTimer = function() {
        const seconds = Math.floor((Date.now() - startedAt) / 1000);
        if (seconds === shownSeconds) return;
        shownSeconds = seconds;
        $("#hud-time").text(formatTime(seconds * 1000));
    };

    const formatWinRate = function(p) {
        const games = p.wins + p.losses;
        if (!games) return "-";
        return `${Math.round(100 * p.wins / games)}% (${p.wins}W / ${p.losses}L)`;
    };

    const formatWilsonScore = function(p) {
        if (!p.totalGames) return "-";
        return `${p.wilsonScore.toFixed(2)} (${p.wins}W / ${p.losses}L)`;
    }

    const drawSprite = function(ctx, sheetName, e, x, y, t, time, frame, fallback) {
        const sheet = images[sheetName];
        if (ready(sheet)) {
            let column = 0;
            if (frame === "fire") column = Math.floor(time / FIRE_FRAME_MS) % 4;
            else if (frame === "walk" && e.moving) column = 1 + Math.floor(time / FRAME_MS) % WALK_FRAMES;
            ctx.drawImage(sheet, column * TILE_SRC, SPRITE_ROW[e.dir] * TILE_SRC,
                TILE_SRC, TILE_SRC, x, y, t, t);
        }
    };

    const draw = function(time) {
        if (!animating) return;
        requestAnimationFrame(draw);
        if (phase === "playing") updateTimer();

        const cv = canvas();
        const dpr = window.devicePixelRatio || 1;
        const w = Math.max(1, Math.floor(cv.clientWidth * dpr));
        const h = Math.max(1, Math.floor(cv.clientHeight * dpr));
        if (cv.width !== w || cv.height !== h) {
            cv.width = w;
            cv.height = h;
        }
        const ctx = cv.getContext("2d");
        ctx.imageSmoothingEnabled = false;
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, w, h);
        if (!maze || !current) return;

        const over = phase === "over";
        const me = current.players.find((p) => p.username == user.username);

        const view = over || cheating ? SIZE : VIEW;
        const half = (view - 1) / 2;
        const t = Math.max(1, Math.floor(Math.min(w, h) / view));
        const ox = Math.floor((w - t * view) / 2);
        const oy = Math.floor((h - t * view) / 2);
        const cx = over || cheating ? half : me.x;
        const cy = over || cheating ? half : me.y;
        const lit = over || cheating ? null : Lighting.computeLit(isWall, SIZE, me.x, me.y, me.dir);

        const isLit = (x, y) => x >= 0 && y >= 0 && x < SIZE && y < SIZE && (over || cheating || lit[y * SIZE + x] === 1);
        const inView = (x, y) => Math.abs(x - cx) <= half && Math.abs(y - cy) <= half;
        const screenX = (x) => ox + (x - cx + half) * t;
        const screenY = (y) => oy + (y - cy + half) * t;
        const visible = (e) => inView(e.x, e.y) && isLit(e.x, e.y);

        for (let y = cy - half; y <= cy + half; y++) {
            for (let x = cx - half; x <= cx + half; x++) {
                if (!isLit(x, y)) continue;
                const wall = isWall(x, y);
                const img = images[wall ? "wall" : "floor"];
                if (ready(img)) {
                    ctx.drawImage(img, screenX(x), screenY(y), t, t);
                } else {
                    ctx.fillStyle = wall ? "#2b3a8c" : "#555";
                    ctx.fillRect(screenX(x), screenY(y), t, t);
                }
            }
        }

        const walk = over ? "still" : "walk";
        const fire = over ? "still" : "fire";

        if (current.echo.alive && visible(current.echo))
            drawSprite(ctx, "spritesheet-echo", current.echo, screenX(current.echo.x), screenY(current.echo.y), t, time, walk, "#ddd");
        for (const ph of current.phantoms) {
            if (visible(ph))
                drawSprite(ctx, "spritesheet-phantom", ph, screenX(ph.x), screenY(ph.y), t, time, walk, "#a0f");
        }
        for (const f of current.fireballs) {
            if (visible(f))
                drawSprite(ctx, "spritesheet-fireball", f, screenX(f.x), screenY(f.y), t, time, fire, "#f80");
        }
        const ordered = [...current.players].sort((a) => (a.username == user.username ? 1 : -1));
        for (const p of ordered) {
            if (visible(p))
                drawSprite(ctx, `spritesheet-player-${spriteOf[p.username]}`, p, screenX(p.x), screenY(p.y), t, time, walk,
                    spriteOf[p.username] == 1 ? "#4aa8ff" : "#ff6a4a");
        }
    };

    const describeResult = function(r) {
        const you = user.username;
        switch (r.reason) {
            case "echo":
                return r.winner == you ? "You reached Echo first!" : `${r.winner} reached Echo first.`;
            case "phantom":
                return r.loser == you ? "A Phantom took your soul." : `A Phantom took ${r.loser}'s soul.`;
            case "fireball":
                return r.loser == you
                    ? `You were hit by ${r.winner}'s fireball.`
                    : `Your fireball hit ${r.loser}!`;
            case "echo_killed":
                return r.loser == you
                    ? "You killed Echo with your fireball."
                    : `${r.loser} killed Echo with a fireball.`;
        }
        return "";
    };

    const sendInput = function(dir, held) {
        if (socket) socket.emit("input", { dir, held });
    };

    const releaseAll = function() {
        if (!heldKeys.length) return;
        const last = heldKeys[heldKeys.length - 1];
        heldKeys = [];
        sendInput(last, false);
    };

    const initKeyboard = function() {
        $(document).on("keydown", function(e) {
            if (phase !== "playing" || e.ctrlKey || e.metaKey || e.altKey) return;

            // Cheating enabled
            if (e.key === "q" || e.key === "Q" || e.originalEvent.code === "KeyQ") {
                e.preventDefault();
                cheating = !cheating;
                return;
            }

            // Left or right Shift shoots a fireball
            if (e.originalEvent.code === "ShiftLeft" || e.originalEvent.code === "ShiftRight") {
                e.preventDefault();
                if (!e.originalEvent.repeat && socket) socket.emit("shoot");
                return;
            }

            const dir = KEYS[(e.key || "").toLowerCase()];
            if (!dir) return;
            e.preventDefault();
            if (e.originalEvent.repeat) return;

            heldKeys = heldKeys.filter((d) => d !== dir);
            heldKeys.push(dir);
            sendInput(dir, true);
        });

        $(document).on("keyup", function(e) {
            const dir = KEYS[(e.key || "").toLowerCase()];
            if (phase !== "playing" || !dir) return;
            e.preventDefault();

            const wasLast = heldKeys[heldKeys.length - 1] === dir;
            heldKeys = heldKeys.filter((d) => d !== dir);
            if (!wasLast) return;

            // Fall back to another key that is still held, otherwise stop
            if (heldKeys.length) sendInput(heldKeys[heldKeys.length - 1], true);
            else sendInput(dir, false);
        });

        $(window).on("blur", releaseAll);
    };

    const join = function(currentUser) {
        user = currentUser;
        $("#content-message").text("Connecting...");
        $("#join-lobby-button").prop("disabled", true);

        // Connect to the Socket.IO server (the session cookie authenticates us)
        socket = io();
        const thisSocket = socket;

        thisSocket.on("connect_error", (error) => {
            if (thisSocket !== socket) return;
            exitLobby(error.message);
        });

        thisSocket.on("connect", () => {
            thisSocket.emit("join");
        });

        // The lobby is full / a game is running / etc.
        thisSocket.on("join_error", (error) => {
            exitLobby(error);
        });

        thisSocket.on("join_success", () => {
            inLobby = true;
            phase = "lobby";
            spriteOf = {};
            lastPlayers = [];
            $("#game-message").text("");
            $("#ready-button").show();
            updatePlayers([]);
            $("#content-message").text("");
            showPage("#game-room-lobby-page");
        });

        thisSocket.on("update_players", (players) => {
            if (!inLobby) return;
            lastPlayers = players;
            updatePlayers(players);
            updateWaiting();
        });

        // The maze is sent once, followed by the positions
        thisSocket.on("game_start", (data) => {
            if (!inLobby) return;
            phase = "playing";
            maze = data.maze;
            spriteOf = {};
            for (const p of data.players) spriteOf[p.username] = p.sprite;
            current = null;
            heldKeys = [];

            $("#game-over-overlay").hide();
            showPage("#game-room-game-page");

            // Fireballs left + time (HTML on top of the canvas), and the music
            startedAt = Date.now();
            shownSeconds = -1;
            $("#hud-fireballs").text("3");
            $("#hud-time").text("00:00");
            $("#game-hud").show();
            Sound.startMusic();

            if (!animating) {
                animating = true;
                requestAnimationFrame(draw);
            }
        });

        thisSocket.on("game_state", (state) => {
            if (!inLobby) return;
            current = state;

            const me = state.players.find((p) => p.username == user.username);
            if (me) $("#hud-fireballs").text(me.shots);
        });

        thisSocket.on("game_event", (event) => {
            if (!inLobby || phase !== "playing") return;
            if (event.type === "fireball_throw") Sound.play("fireball-throw");
            else if (event.type === "fireball_end") Sound.play("fireball-end");
        });

        thisSocket.on("game_end", (result) => {
            if (!inLobby) return;
            phase = "over";
            heldKeys = [];
            lastPlayers = result.players;
            updatePlayers(lastPlayers);

            Sound.stopMusic();
            if (result.reason === "echo") Sound.play("echo-end");
            else if (result.reason === "phantom") Sound.play("phantom-capture");

            $("#game-hud").hide();
            $("#game-over-title").text(result.winner == user.username ? "You win!" : "You lose!");
            $("#game-over-reason").text(describeResult(result));

            $("#game-over-time").text(`Time: ${formatTime(result.elapsedMs)}`);
            const rates = $("#game-over-winrates").empty();
            for (const p of result.players) {
                const row = $('<div class="winrate-row"></div>');
                row.append($("<span></span>").text(p.username == user.username ? `${p.username} (you)` : p.username));
                row.append($("<span></span>").text(`Win rate: ${formatWinRate(p)}`));
                rates.append(row);
            }
            const leaderboard = $("#game-over-leaderboard").empty();
            var rank = 1;
            for (const p of result.leaderboard) {
                console.log(p);
                const row = $('<div class="winrate-row"></div>');
                const displayName = p.username == user.username ? `${p.username} (you)` : p.username;
                row.append($("<span></span>").text(`${rank++} ${displayName}`));
                row.append($("<span></span>").text(`Wilson score: ${formatWilsonScore(p)}`));
                leaderboard.append(row);
            }
            $("#game-over-overlay").show();
            updateWaiting();
        });

        thisSocket.on("game_cancelled", (message) => {
            if (!inLobby) return;
            backToLobbyPage();
            $("#game-message").text(message);
            $("#ready-button").show();
        });

        thisSocket.on("disconnect", () => {
            if (thisSocket !== socket) return;
            exitLobby("You have been disconnected from the lobby.");
        });
    };

    const init = function() {
        initKeyboard();

        $("#ready-button").on("click", function() {
            $("#game-message").text("");
            $(this).hide();
            socket.emit("ready");
        });

        $("#leave-button, #over-leave-button").on("click", function() {
            exitLobby();
        });

        $("#play-again-button").on("click", function() {
            backToLobbyPage();
            $("#game-message").text("");
            $("#ready-button").hide();
            socket.emit("ready");
        });
    };

    const leave = function() {
        if (socket) exitLobby();
    };

    return { init, join, leave };
})();
