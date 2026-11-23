const Lighting = (function() {
    const BEAM = 5;
    const DIRS = { down: [0, 1], left: [-1, 0], right: [1, 0], up: [0, -1] };

    const computeLit = function(isWall, size, px, py, dir) {
        const lit = new Uint8Array(size * size);
        const inside = (x, y) => x >= 0 && y >= 0 && x < size && y < size;
        const light = (x, y) => { if (inside(x, y)) lit[y * size + x] = 1; };
        const wall = (x, y) => !inside(x, y) || isWall(x, y);

        // Only light the player's own tile
        light(px, py);

        const beamFloors = [];

        // Loop through all 4 directions for the beam
        for (const [dx, dy] of Object.values(DIRS)) {
            for (let i = 1; i <= BEAM; i++) {
                const x = px + dx * i;
                const y = py + dy * i;
                if (!inside(x, y)) break;
                light(x, y);
                if (wall(x, y)) break;
                beamFloors.push([x, y]);
            }
        }

        // Light all adjacent tiles next to the lit floor of the beams
        for (const [x, y] of beamFloors) {
            for (const [ox, oy] of Object.values(DIRS)) {
                light(x + ox, y + oy);
            }
        }
        return lit;
    };

    return { computeLit, BEAM };
})();

if (typeof module !== "undefined") module.exports = Lighting;
