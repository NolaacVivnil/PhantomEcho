// Maze generator: a SIZE x SIZE grid of tiles, each WALL (1) or FLOOR (0).
//
// 1. A "perfect" maze is carved with a randomized depth-first search.
// 2. Dead ends are opened up and some extra walls are knocked down, so the maze has
//    many loops (Pacman-like). Nothing is mirrored, so every maze is asymmetric.
// 3. The middle tile and its 4 neighbours are always open (that is where Echo starts).
const SIZE = 31;
const WALL = 1;
const FLOOR = 0;

function generateMaze(random = Math.random) {
    const grid = Array.from({ length: SIZE }, () => Array(SIZE).fill(WALL));
    const randInt = (n) => Math.floor(random() * n);
    const inside = (x, y) => x >= 1 && y >= 1 && x <= SIZE - 2 && y <= SIZE - 2;
    const DELTAS = [[0, -1], [0, 1], [-1, 0], [1, 0]];

    // 1. Depth-first carving; rooms live on odd coordinates
    const cells = (SIZE - 1) / 2;
    const start = [1 + 2 * randInt(cells), 1 + 2 * randInt(cells)];
    grid[start[1]][start[0]] = FLOOR;
    const stack = [start];
    while (stack.length) {
        const [x, y] = stack[stack.length - 1];
        const options = DELTAS
            .map(([dx, dy]) => [x + 2 * dx, y + 2 * dy, x + dx, y + dy])
            .filter(([nx, ny]) => inside(nx, ny) && grid[ny][nx] === WALL);
        if (!options.length) {
            stack.pop();
            continue;
        }
        const [nx, ny, wx, wy] = options[randInt(options.length)];
        grid[wy][wx] = FLOOR;
        grid[ny][nx] = FLOOR;
        stack.push([nx, ny]);
    }

    // 2a. Open up most dead ends by knocking a wall to a neighbouring room
    const floorNeighbours = (x, y) =>
        DELTAS.filter(([dx, dy]) => grid[y + dy][x + dx] === FLOOR).length;
    for (let y = 1; y < SIZE; y += 2) {
        for (let x = 1; x < SIZE; x += 2) {
            if (floorNeighbours(x, y) !== 1 || random() > 0.9) continue;
            const walls = DELTAS.filter(([dx, dy]) =>
                grid[y + dy][x + dx] === WALL && inside(x + 2 * dx, y + 2 * dy));
            if (walls.length) {
                const [dx, dy] = walls[randInt(walls.length)];
                grid[y + dy][x + dx] = FLOOR;
            }
        }
    }

    // 2b. Knock down a few more random walls between rooms
    for (let y = 1; y < SIZE - 1; y++) {
        for (let x = 1; x < SIZE - 1; x++) {
            if ((x + y) % 2 === 1 && random() < 0.07) grid[y][x] = FLOOR;
        }
    }

    // 3. The middle: Echo's starting tile, with 4 open neighbours
    const mid = (SIZE - 1) / 2;
    for (const [dx, dy] of [[0, 0], ...DELTAS]) grid[mid + dy][mid + dx] = FLOOR;

    return grid;
}

module.exports = { generateMaze, SIZE, WALL, FLOOR };
