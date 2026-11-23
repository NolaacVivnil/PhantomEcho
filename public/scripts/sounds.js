// Sound effects and background music (files in public/sounds/).
const Sound = (function() {
    const FILES = {
        "background": "sounds/background.mp3",
        "fireball-throw": "sounds/fireball-throw.mp3",
        "fireball-end": "sounds/fireball-end.mp3",
        "echo-end": "sounds/echo-end.mp3",
        "phantom-capture": "sounds/phantom-capture.mp3"
    };
    const MUSIC_VOLUME = 0.4;
    const EFFECT_VOLUME = 0.8;

    const audio = {};
    for (const [name, src] of Object.entries(FILES)) {
        audio[name] = new Audio(src);
        audio[name].preload = "auto";
    }
    audio["background"].loop = true;
    audio["background"].volume = MUSIC_VOLUME;

    // Playing can be refused
    const safePlay = (a) => {
        try {
            const promise = a.play();
            if (promise && promise.catch) promise.catch(() => {});
        } catch (e) { /* ignore */ }
    };

    // A sound effect; a copy is played so that the same effect can overlap itself
    const play = function(name) {
        if (!audio[name] || name === "background") return;
        const a = audio[name].cloneNode();
        a.volume = EFFECT_VOLUME;
        safePlay(a);
    };

    // The background music repeats until it is stopped
    const startMusic = function() {
        const music = audio["background"];
        music.currentTime = 0;
        safePlay(music);
    };

    const stopMusic = function() {
        const music = audio["background"];
        music.pause();
        music.currentTime = 0;
    };

    return { play, startMusic, stopMusic };
})();
