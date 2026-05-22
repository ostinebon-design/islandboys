// --- GAME PHASES & TURN LOGIC ---
let gameStarted = false;
let isDecidingTurn = true;
let p1StartRoll = 0, p2StartRoll = 0;
let rollingForPlayer = 1;
const ROWS = 20;
const COLS = 6;
let gridNumbers = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
let targetGoal = 0;
let currentTurn = 1, roundP1 = 1, roundP2 = 1, movesThisTurn = 0;
let p1MovedThisRound = false, p2MovedThisRound = false;
let currentOperation = "?";
let needsToRollOp = true, gameOver = false, isPaused = false;

// --- Integrated Message State ---
let systemMessage = "";
let waitingForPowerUpChoice = false;
let waitingToRollPowerUp = false;
let powerUpRecipient = null;
let preRolledPowerUp = "";

// --- TELEPORT STATE VARIABLES ---
let isTeleportPending = false;
let pendingTeleportDirection = -1; // 0 = Left, 1 = Top, 2 = Right

// --- DOUBLE TILE STATE VARIABLES ---
let p1HasDoubleTile = false;
let p2HasDoubleTile = false;

// --- DYNAMIC RENDERING ANIMATION CONTROLLERS ---
let animationFrames = 0;
let currentDiceImg = null;
let isAnimating = false;
let isRollingPowerUp = false;

// --- GRAPHIC ASSETS PRELOAD SYSTEM LOGIC ---
const images = {};
const assetPaths = {
    gameBg: 'assets/dagat.png',
    island: 'assets/island.png',
    heli: 'assets/helicopter.png',
    scoreBgImg: 'assets/scorebg.png',
    red: 'assets/red.png',
    blue: 'assets/blue.png',
    tp: 'assets/tp.png',
    co: 'assets/co.jpg',
    sx: 'assets/sx.png'
};

// Procedural arrays map variables inside processing calculations loops
let diceImages = Array(6);
let opDiceImages = Array(2);
let powerUpImages = Array(3);

let totalAssets = Object.keys(assetPaths).length + 6 + 2; 
let loadedAssetsCount = 0;

function checkAllAssetsLoaded() {
    loadedAssetsCount++;
    if (loadedAssetsCount === totalAssets) {
        console.log("All execution source assets stored safely.");
        // Link the indexed structural references exactly as NetBeans structures did
        powerUpImages[0] = images['tp'];
        powerUpImages[1] = images['co'];
        powerUpImages[2] = images['sx'];
    }
}

// Map the dynamic references matching numerical lookups inside animations loops
function loadGameAssets() {
    for (let key in assetPaths) {
        images[key] = new Image();
        images[key].src = assetPaths[key];
        images[key].onload = checkAllAssetsLoaded;
    }
    for (let i = 0; i < 6; i++) {
        diceImages[i] = new Image();
        diceImages[i].src = `assets/dice${i + 1}.jpeg`;
        diceImages[i].onload = checkAllAssetsLoaded;
    }
    opDiceImages[0] = new Image();
    opDiceImages[0].src = 'assets/op_add.png';
    opDiceImages[0].onload = checkAllAssetsLoaded;

    opDiceImages[1] = new Image();
    opDiceImages[1].src = 'assets/op_sub.png';
    opDiceImages[1].onload = checkAllAssetsLoaded;
}

loadGameAssets();

// --- ACTIVE PLAYER HOISTING RECONSTRUCTIONS ---
class Player {
    constructor(startCol, name, imageKey) {
        this.row = ROWS;
        this.col = startCol;
        this.currentTotal = 0;
        this.timeLeft = 300;
        this.name = name;
        this.imageKey = imageKey;
        this.timer = null;
    }

    startTimer() {
        if (this.timer) return;
        this.timer = setInterval(() => {
            if (this.timeLeft > 0 && !isPaused) {
                this.timeLeft--;
                repaintAll();
            } else if (this.timeLeft <= 0) {
                this.stopTimer();
                systemMessage = this.name + " ran out of time!";
                endTurn();
            }
        }, 1000);
    }

    stopTimer() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }
}

let p1 = new Player(1, "P1", "red");
let p2 = new Player(4, "P2", "blue");

// --- INTERFACE DOM CONTROLLER ELEMENTS SELECTORS ---
const canvas = document.getElementById("gameCanvas");
const g2d = canvas.getContext("2d");

function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
}

// --- EVENT MANAGEMENT TRIGGERS ---
document.getElementById("playBtn").addEventListener("click", () => {
    gameStarted = true;
    showScreen("activeGamePanel");
    resetGame();
    window.focus();
});

document.getElementById("homeTutBtn").addEventListener("click", () => showScreen("tutorialPanel"));
document.getElementById("tutBackBtn").addEventListener("click", () => showScreen("homePanel"));
document.getElementById("homeExitBtn").addEventListener("click", () => window.close());

document.getElementById("gamePauseBtn").addEventListener("click", togglePause);
document.getElementById("resumeBtn").addEventListener("click", resumeGame);
document.getElementById("quitBtn").addEventListener("click", () => {
    resumeGame();
    resetGame();
    showScreen("homePanel");
});

document.getElementById("rollBtn").addEventListener("click", () => {
    if (!gameOver && !isPaused && !waitingForPowerUpChoice) {
        if (waitingToRollPowerUp) {
            startPowerUpAnimation();
        } else if (needsToRollOp) {
            startDiceAnimation();
        }
    }
});

window.addEventListener("keydown", (e) => {
    if (!gameStarted || gameOver || isPaused || isAnimating) return;

    let key = e.key;
    let keyLower = key.toLowerCase();
    if (["arrowup", "arrowleft", "arrowright", "w", "a", "d", "y", "n"].includes(keyLower)) {
        e.preventDefault();
    }
    
    if (waitingForPowerUpChoice) {
        if (keyLower === 'y') {
            applyRandomPowerUp(powerUpRecipient);
        } else if (keyLower === 'n') {
            systemMessage = "💨 " + powerUpRecipient.name + " DECLINED. Roll Operation!";
            waitingForPowerUpChoice = false;
            powerUpRecipient = null;
            preRolledPowerUp = "";
            currentDiceImg = null;
            repaintAll();
        }
        return;
    }
    if (isDecidingTurn || needsToRollOp) return;
    handleMovement(key);
    repaintAll();
});

// --- CORE RENDERING ENGINE CALCULATIONS MAPS ---
function repaintAll() {
    g2d.clearRect(0, 0, canvas.width, canvas.height);
    
    g2d.fillStyle = "#000000";
    g2d.fillRect(0, 0, canvas.width, canvas.height);
    
    if (images.gameBg && images.gameBg.complete) {
        g2d.drawImage(images.gameBg, 0, 0, canvas.width, canvas.height);
    }
    if (images.island && images.island.complete) {
        g2d.drawImage(images.island, (canvas.width - 450) / 2, 0, 450, 280);
    }
    if (images.heli && images.heli.complete) {
        g2d.drawImage(images.heli, (canvas.width / 2) - 100, 100, 200, 100);
    }

    drawTargetSign(g2d, (canvas.width / 2) - 60, 195, String(targetGoal));
    let displayRound = (currentTurn === 1) ? roundP1 : roundP2;
    drawRoundSign(g2d, (canvas.width / 2) - 60, 250, "ROUND " + displayRound);
    
    renderGrid(g2d);

    if (!isAnimating) {
        if (!systemMessage || systemMessage.includes("ROLL")) {
            if (isDecidingTurn) {
                let pName = (rollingForPlayer === 1) ? "P1" : "P2";
                if (p1StartRoll === 0 && p2StartRoll === 0) systemMessage = pName + ": ROLL TO START";
                else if (p1StartRoll > 0 && p2StartRoll === 0) systemMessage = "P1 rolled " + p1StartRoll + ". P2 ROLL!";
                else if (p2StartRoll > 0 && p1StartRoll === 0) systemMessage = "P2 rolled " + p2StartRoll + ". P1 ROLL!";
            } else if (needsToRollOp && !waitingToRollPowerUp) {
                systemMessage = ((currentTurn === 1) ? "P1" : "P2") + ": ROLL OPERATION";
            }
        }

        if (systemMessage) {
            g2d.fillStyle = "rgba(0, 0, 0, 0.78)";
            g2d.fillRect(40, 340, 520, 140);
            g2d.fillStyle = "#FFFF00";
            
            if (systemMessage.includes("\n")) {
                g2d.font = "bold 16px Arial";
                let lines = systemMessage.split("\n");
                let startY = 365;
                lines.forEach(line => {
                    g2d.fillText(line, (canvas.width - g2d.measureText(line).width) / 2, startY);
                    startY += 25;
                });
            } else {
                g2d.font = "bold 20px Arial";
                g2d.fillText(systemMessage, (canvas.width - g2d.measureText(systemMessage).width) / 2, 420);
            }
        }
    }

    if (currentDiceImg && currentDiceImg.complete) {
        g2d.drawImage(currentDiceImg, canvas.width / 2 - 50, canvas.height - 180, 100, 100);
    }
    drawScoreBoards(g2d);
}

function renderGrid(g2d) {
    let seaStartY = 270, seaEndY = canvas.height - 180;
    let topW = 220, botW = 500, centerX = 300;

    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            let progT = r / ROWS, progB = (r + 1) / ROWS;
            let yT = seaStartY + (progT * (seaEndY - seaStartY));
            let yB = seaStartY + (progB * (seaEndY - seaStartY));
            let wT = topW + (progT * (botW - topW));
            let wB = topW + (progB * (botW - topW));

            let xTL = centerX - (wT / 2) + (c * wT / COLS);
            let xTR = centerX - (wT / 2) + ((c + 1) * wT / COLS);
            let xBL = centerX - (wB / 2) + (c * wB / COLS);
            let xBR = centerX - (wB / 2) + ((c + 1) * wB / COLS);

            g2d.beginPath();
            g2d.moveTo(xTL, yT); g2d.lineTo(xTR, yT);
            g2d.lineTo(xBR, yB); g2d.lineTo(xBL, yB);
            g2d.closePath();

            if (r === 0) {
                g2d.fillStyle = (c % 2 === 0) ? "#FFFFFF" : "#000000";
                g2d.fill();
                g2d.strokeStyle = (c % 2 === 0) ? "#000000" : "#FFFFFF";
                g2d.stroke();
            } else {
                g2d.fillStyle = "rgba(0, 100, 200, 0.58)";
                g2d.fill();
                g2d.strokeStyle = "rgba(255, 255, 255, 0.2)";
                g2d.stroke();

                g2d.fillStyle = "#FFFFFF";
                g2d.font = "bold 16px Monospaced";
                g2d.fillText(String(gridNumbers[r][c]), (xTL + xBR) / 2 - 5, (yT + yB) / 2 + 5);
            }
        }
    }
drawPlayerAtPos(g2d, p1, seaStartY, seaEndY, topW, botW, centerX);
drawPlayerAtPos(g2d, p2, seaStartY, seaEndY, topW, botW, centerX);
}

function drawPlayerAtPos(g2d, p, seaStartY, seaEndY, topW, botW, centerX) {

    let progT = Math.min(p.row, ROWS - 1) / ROWS;
    let progB = (Math.min(p.row, ROWS - 1) + 1) / ROWS;

    let yT = seaStartY + (progT * (seaEndY - seaStartY));
    let yB = seaStartY + (progB * (seaEndY - seaStartY));

    let wT = topW + (progT * (botW - topW));
    let wB = topW + (progB * (botW - topW));

    let xTL = centerX - (wT / 2) + (p.col * wT / COLS);
    let xTR = centerX - (wT / 2) + ((p.col + 1) * wT / COLS);

    let xBL = centerX - (wB / 2) + (p.col * wB / COLS);
    let xBR = centerX - (wB / 2) + ((p.col + 1) * wB / COLS);

    let imgObj = images[p.imageKey];

    if (p.row === ROWS) {
        drawPlayer(g2d, xTL, xTR, xBL, xBR, yT + 40, yB + 40, imgObj);
    } else {
        drawPlayer(g2d, xTL, xTR, xBL, xBR, yT, yB, imgObj);
    }
}

function drawPlayer(g2d, xL1, xR1, xL2, xR2, y1, y2, img) {

    if (!img || !img.complete) return;

    let w = (xR1 - xL1 + xR2 - xL2) / 2;
    let h = y2 - y1;

    g2d.drawImage(
        img,
        (xL1 + xR1 + xL2 + xR2) / 4 - (w * 0.4),
        (y1 + y2) / 2 - (h * 0.4),
        w * 0.8,
        h * 0.8
    );
}

// --- SIGN RENDER FORMATTING ---

function drawSign(g2d, x, y, l1, l2, pc) {

    if (images.scoreBgImg && images.scoreBgImg.complete) {
        g2d.drawImage(images.scoreBgImg, x, y, 180, 80);
    } else {
        g2d.fillStyle = "#8B4513";
        g2d.fillRect(x, y, 180, 80);
    }

    g2d.fillStyle = "#FFFFFF";
    g2d.font = "bold 20px Courier New";
    g2d.fillText(l1, x + 20, y + 35);

    g2d.font = "13px Arial";
    g2d.fillStyle = pc;
    g2d.fillText(l2, x + 20, y + 55);
}

function drawTargetSign(g2d, x, y, text) {

    if (images.scoreBgImg && images.scoreBgImg.complete) {
        g2d.drawImage(images.scoreBgImg, x, y, 120, 50);
    } else {
        g2d.fillStyle = "#8B4513";
        g2d.fillRect(x, y, 120, 50);
    }

    g2d.fillStyle = "#FFFF00";
    g2d.font = "bold 30px Arial";

    g2d.fillText(
        text,
        x + (120 / 2) - (g2d.measureText(text).width / 2),
        y + 35
    );
}

function drawRoundSign(g2d, x, y, text) {

    y -= 10;

    if (images.scoreBgImg && images.scoreBgImg.complete) {
        g2d.drawImage(images.scoreBgImg, x, y, 120, 30);
    } else {
        g2d.fillStyle = "#654321";
        g2d.fillRect(x, y, 120, 30);
    }

    g2d.fillStyle = "#FFFFFF";
    g2d.font = "bold 14px Arial";

    g2d.fillText(
        text,
        x + (120 / 2) - (g2d.measureText(text).width / 2),
        y + 20
    );

    try {

        let currentRoundNum = parseInt(text.replace(/[^0-9]/g, ""));

        if ((currentRoundNum + 1) % 3 === 0) {

            let warningText = "⚠️ POWER-UP NEXT!";

            g2d.font = "bold 12px Arial";

            let warnWidth = g2d.measureText(warningText).width;

            g2d.fillStyle = "rgba(255, 69, 0, 0.75)";
            g2d.fillRect(x - 15, y + 35, 150, 22);

            g2d.fillStyle = "#FFFF00";

            g2d.fillText(
                warningText,
                (x + 60) - (warnWidth / 2),
                y + 50
            );
        }

    } catch (e) {}
}

function drawScoreBoards(g2d) {

    drawSign(
        g2d,
        15,
        30,
        "P1: " + p1.currentTotal,
        "Time: " + p1.timeLeft,
        "#FFFFFF"
    );

    drawSign(
        g2d,
        405,
        30,
        "P2: " + p2.currentTotal,
        "Time: " + p2.timeLeft,
        "#FFFFFF"
    );
}

// --- ENGINE REACTION MECHANICS ---

function randomizeGrid() {

    for (let r = 0; r < ROWS; r++) {

        for (let c = 0; c < COLS; c++) {

            gridNumbers[r][c] = Math.floor(Math.random() * 10);
        }
    }
}

function resetGame() {

    p1.stopTimer();
    p2.stopTimer();

    p1.row = ROWS;
    p1.col = 1;
    p1.currentTotal = 0;
    p1.timeLeft = 300;

    p2.row = ROWS;
    p2.col = 4;
    p2.currentTotal = 0;
    p2.timeLeft = 300;

    currentTurn = 1;

    roundP1 = 1;
    roundP2 = 1;

    movesThisTurn = 0;

    p1MovedThisRound = false;
    p2MovedThisRound = false;

    needsToRollOp = true;
    isDecidingTurn = true;

    p1StartRoll = 0;
    p2StartRoll = 0;

    rollingForPlayer = 1;

    gameOver = false;
    isPaused = false;

    systemMessage = "";

    waitingForPowerUpChoice = false;
    waitingToRollPowerUp = false;

    powerUpRecipient = null;

    preRolledPowerUp = "";

    isTeleportPending = false;
    pendingTeleportDirection = -1;

    p1HasDoubleTile = false;
    p2HasDoubleTile = false;

    currentDiceImg = null;

    targetGoal = Math.floor(Math.random() * 101);

    randomizeGrid();

    repaintAll();
}

function startDiceAnimation() {

    document.getElementById("rollBtn").disabled = true;

    isAnimating = true;
    animationFrames = 0;

    let animTimer = setInterval(() => {

        animationFrames++;

        if (isDecidingTurn) {

            currentDiceImg = diceImages[Math.floor(Math.random() * 6)];

        } else {

            currentDiceImg = opDiceImages[Math.floor(Math.random() * 2)];
        }

        repaintAll();

        if (animationFrames > 12) {

            clearInterval(animTimer);

            finalizeRoll();
        }

    }, 80);
}

function finalizeRoll() {

    if (isDecidingTurn) {

        let rollValue = Math.floor(Math.random() * 6) + 1;

        let ongoingRound = (rollingForPlayer === 1)
            ? roundP1
            : roundP2;

        if (rollingForPlayer === 1) {

            p1StartRoll = rollValue;

            if (ongoingRound > 1 && p1StartRoll === 1) {

                p2StartRoll = -1;

                systemMessage =
                    "🎲 P1 rolled 1 in Round " +
                    ongoingRound +
                    "! Moving first.";

            } else if (p2StartRoll === 0) {

                rollingForPlayer = 2;
            }

        } else {

            p2StartRoll = rollValue;

            if (ongoingRound > 1 && p2StartRoll === 1) {

                p1StartRoll = -1;

                systemMessage =
                    "🎲 P2 rolled 1 in Round " +
                    ongoingRound +
                    "! Moving first.";

            } else if (p1StartRoll === 0) {

                rollingForPlayer = 1;
            }
        }

        if (p1StartRoll !== 0 && p2StartRoll !== 0) {

            if (
                p1StartRoll === p2StartRoll &&
                p1StartRoll > 0
            ) {

                p1StartRoll = 0;
                p2StartRoll = 0;

                rollingForPlayer =
                    (p1.timeLeft >= p2.timeLeft) ? 1 : 2;

            } else {

                currentTurn =
                    (p1StartRoll < p2StartRoll) ? 1 : 2;

                isDecidingTurn = false;

                let currentRound =
                    (currentTurn === 1)
                        ? roundP1
                        : roundP2;

                if (currentRound % 3 === 0) {

                    triggerPowerUpIntegrated();

                } else {

                    systemMessage =
                        "Player " +
                        currentTurn +
                        " moves first! Roll Operation.";
                }
            }
        }

    } else {

        let opRoll = Math.floor(Math.random() * 2);

        currentOperation = (opRoll === 0) ? "+" : "-";

        currentDiceImg = opDiceImages[opRoll];

        needsToRollOp = false;

        systemMessage = "";

        if (isTeleportPending) {

            executePendingTeleport();

        } else {

            if (currentTurn === 1) {
                p1.startTimer();
            } else {
                p2.startTimer();
            }
        }
    }

    isAnimating = false;

    document.getElementById("rollBtn").disabled = false;

    repaintAll();
}

// --- POWER-UP RULES ENGINE ---

function triggerPowerUpIntegrated() {

    powerUpRecipient = (currentTurn === 1)
        ? p1
        : p2;

    let activeRound = (currentTurn === 1)
        ? roundP1
        : roundP2;

    waitingToRollPowerUp = true;

    needsToRollOp = true;

    systemMessage =
        "🎰 " +
        powerUpRecipient.name +
        " moves first in Round " +
        activeRound +
        "!\nClick 'ROLL' to spin for a Power-Up!";
}

function startPowerUpAnimation() {

    waitingToRollPowerUp = false;

    let powerUps = [
        "Teleport",
        "Operation Changer",
        "Double",
        "No Power Up"
    ];

    preRolledPowerUp =
        powerUps[Math.floor(Math.random() * powerUps.length)];

    let activeRound = (currentTurn === 1)
        ? roundP1
        : roundP2;

    isRollingPowerUp = true;
    isAnimating = true;

    document.getElementById("rollBtn").disabled = true;

    let frames = 0;

    let pTimer = setInterval(() => {

        frames++;

        if (frames <= 14) {

            let loadedKeys = ["tp", "co", "sx"];

            let randKey =
                loadedKeys[Math.floor(Math.random() * loadedKeys.length)];

            currentDiceImg = images[randKey];

            repaintAll();

        } else {

            clearInterval(pTimer);

            isRollingPowerUp = false;
            isAnimating = false;

            document.getElementById("rollBtn").disabled = false;

            if (preRolledPowerUp === "No Power Up") {
                systemMessage = "👑 " + powerUpRecipient.name + " moves first in Round " + activeRound + "!\n💨 NO POWER UP. Roll Operation to continue.";
                waitingForPowerUpChoice = false;
                powerUpRecipient = null;
                preRolledPowerUp = "";
                currentDiceImg = null;
            } else {
                switch (preRolledPowerUp) {
                    case "Teleport": currentDiceImg = images['tp']; break;
                    case "Operation Changer": currentDiceImg = images['co']; break;
                    case "Double": currentDiceImg = images['sx']; break;
                }
                systemMessage = powerUpRecipient.name + " moves first in Round " + activeRound + "!\nRolled: " + preRolledPowerUp + "\nPress Y to accept, N to decline.";
                waitingForPowerUpChoice = true;
            }

            repaintAll();
        }

    }, 80);
}

function togglePause() {
    isPaused = true;
    p1.stopTimer();
    p2.stopTimer();
    document.getElementById("pauseOverlay").style.display = "block";
    repaintAll();
}

function resumeGame() {
    isPaused = false;
    document.getElementById("pauseOverlay").style.display = "none";
    if (!needsToRollOp && !gameOver && !isDecidingTurn) {
        if (currentTurn === 1) p1.startTimer(); else p2.startTimer();
    }
    repaintAll();
}

function endTurn() {
    p1.stopTimer();
    p2.stopTimer();
    movesThisTurn = 0;

    if (currentTurn === 1) {
        p1MovedThisRound = true;
        roundP1++;
        currentTurn = 2;
    } else {
        p2MovedThisRound = true;
        roundP2++;
        currentTurn = 1;
    }

    if (p1MovedThisRound && p2MovedThisRound) {
        p1MovedThisRound = false;
        p2MovedThisRound = false;
        isDecidingTurn = true;
        needsToRollOp = true;
        p1StartRoll = 0;
        p2StartRoll = 0;
        currentOperation = "?";
        rollingForPlayer = (p1.timeLeft >= p2.timeLeft) ? 1 : 2;
        systemMessage = "";
    } else {
        needsToRollOp = true;
        let nextRound = (currentTurn === 1) ? roundP1 : roundP2;
        systemMessage = (nextRound % 3 === 0)
            ? "⚠️ INCOMING POWER-UP ROUND!"
            : "";
    }

    repaintAll();
}

function executePendingTeleport() {
    isTeleportPending = false;
    let recipient = (currentTurn === 1) ? p1 : p2;
    let targetRow = recipient.row;
    let targetCol = recipient.col;

    if (pendingTeleportDirection === 0) targetCol -= 2;
    else if (pendingTeleportDirection === 1) targetRow -= 2;
    else if (pendingTeleportDirection === 2) targetCol += 2;

    if (targetRow >= 0 && targetRow <= ROWS && targetCol >= 0 && targetCol < COLS) {
        recipient.row = targetRow;
        recipient.col = targetCol;

        if (recipient.row === 0) {
            repaintAll();
            checkWinCondition();
            return;
        }

        if (recipient.row < ROWS) {
            let tileVal = gridNumbers[recipient.row][recipient.col];
            let activeRound = (currentTurn === 1) ? roundP1 : roundP2;
            let hasDouble = (currentTurn === 1) ? p1HasDoubleTile : p2HasDoubleTile;

            if (hasDouble) {
                tileVal *= 2;
                if (currentTurn === 1) p1HasDoubleTile = false;
                else p2HasDoubleTile = false;
            }

            if (activeRound === 1 && movesThisTurn === 0) {
                recipient.currentTotal = tileVal;
            } else {
                applyOperation(recipient, tileVal);
            }
        }

        systemMessage = "🌀 Teleported! Landed on tile value with operator: " + currentOperation;
    } else {
        systemMessage = "🌀 Teleport failed! Out of map bounds.";
    }

    movesThisTurn++;
    let activeRound = (currentTurn === 1) ? roundP1 : roundP2;

    if (activeRound === 1) {
        if (movesThisTurn === 2) endTurn();
        else if (!gameOver) {
            if (currentTurn === 1) p1.startTimer(); else p2.startTimer();
        }
    } else {
        if (movesThisTurn === 1) endTurn();
        else if (!gameOver) {
            if (currentTurn === 1) p1.startTimer(); else p2.startTimer();
        }
    }

    repaintAll();
}

function handleMovement(key) {
    let active = (currentTurn === 1) ? p1 : p2;
    let activeRound = (currentTurn === 1) ? roundP1 : roundP2;
    let targetRow = active.row;
    let targetCol = active.col;

    if (key === "ArrowUp" || key === "w" || key === "W") {
        targetRow--;
    } else if (key === "ArrowLeft" || key === "a" || key === "A") {
        targetCol--;
    } else if (key === "ArrowRight" || key === "d" || key === "D") {
        targetCol++;
    } else {
        return;
    }

    if (targetRow < 0 || targetRow > ROWS || targetCol < 0 || targetCol >= COLS) {
        return;
    }

    active.row = targetRow;
    active.col = targetCol;

    if (active.row === 0) {
        repaintAll();
        checkWinCondition();
        return;
    }

    let tileVal = gridNumbers[active.row][active.col];
    let hasDouble = (currentTurn === 1) ? p1HasDoubleTile : p2HasDoubleTile;

    if (hasDouble) {
        tileVal *= 2;
        if (currentTurn === 1) p1HasDoubleTile = false;
        else p2HasDoubleTile = false;
    }

    if (activeRound === 1 && movesThisTurn === 0) {
        active.currentTotal = tileVal;
    } else {
        applyOperation(active, tileVal);
    }

    movesThisTurn++;
    if (activeRound === 1) {
        if (movesThisTurn === 2) endTurn();
    } else {
        if (movesThisTurn === 1) endTurn();
    }
}

function applyRandomPowerUp(recipient) {
    waitingForPowerUpChoice = false;

    if (preRolledPowerUp === "Teleport") {
        showTeleportPanel(recipient);
        return;
    }

    if (preRolledPowerUp === "Operation Changer") {
        showOperationPanel(recipient);
        return;
    }

    if (preRolledPowerUp === "Double") {
        if (recipient === p1) p1HasDoubleTile = true;
        else p2HasDoubleTile = true;

        systemMessage = "🎉 " + recipient.name + " accepted DOUBLE! Next tile value will be doubled. Roll operation to proceed.";
    }

    preRolledPowerUp = "";
    powerUpRecipient = null;
    currentDiceImg = null;
    repaintAll();
}

function showTeleportPanel(recipient) {
    let choice = prompt("Choose teleport direction:\nL = LEFT\nT = TOP\nR = RIGHT", "T");
    if (!choice) choice = "T";
    choice = choice.trim().toUpperCase();

    let direction = 1;
    let dirName = "TOP";
    if (choice.startsWith("L")) {
        direction = 0;
        dirName = "LEFT";
    } else if (choice.startsWith("R")) {
        direction = 2;
        dirName = "RIGHT";
    }

    pendingTeleportDirection = direction;
    isTeleportPending = true;
    currentDiceImg = null;
    systemMessage = "🌀 Teleport " + dirName + " locked! Now click 'ROLL' to see your operation.";
    preRolledPowerUp = "";
    powerUpRecipient = null;
    waitingForPowerUpChoice = false;
    repaintAll();
}

function showOperationPanel(recipient) {
    let choice = prompt("Choose operator:\n+ - * /", "+");
    if (!choice) choice = "+";
    choice = choice.trim();
    if (!["+", "-", "*", "/"].includes(choice)) choice = "+";

    currentOperation = choice;
    currentDiceImg = null;
    needsToRollOp = false;
    waitingForPowerUpChoice = false;
    preRolledPowerUp = "";
    powerUpRecipient = null;
    systemMessage = recipient.name + " chose operator " + currentOperation + ". Use arrow keys to move.";

    if (currentTurn === 1) p1.startTimer(); else p2.startTimer();
    repaintAll();
}

function applyOperation(player, tileValue) {
    if (currentOperation === "+") player.currentTotal += tileValue;
    else if (currentOperation === "-") player.currentTotal -= tileValue;
    else if (currentOperation === "*") player.currentTotal *= tileValue;
    else if (currentOperation === "/") {
        if (tileValue !== 0) player.currentTotal = Math.trunc(player.currentTotal / tileValue);
    }
}

function checkWinCondition() {
    gameOver = true;
    p1.stopTimer();
    p2.stopTimer();

    let p1Diff = Math.abs(targetGoal - p1.currentTotal);
    let p2Diff = Math.abs(targetGoal - p2.currentTotal);
    let winner = "IT'S A TIE!";

    if (p1Diff < p2Diff) winner = "PLAYER 1 WINS!";
    else if (p2Diff < p1Diff) winner = "PLAYER 2 WINS!";

    alert(winner + "\nTarget: " + targetGoal + "\nP1: " + p1.currentTotal + "\nP2: " + p2.currentTotal);
    repaintAll();
}