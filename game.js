// =============================================
//  MOBILE SIZING
// =============================================
(function mobileSizing() {
    function setControllerHeight() {
        if (window.innerWidth > 768) return;
        const vw    = window.innerWidth;
        const ctrlH = Math.min(302, Math.max(180, vw / 1.988));
        const vh    = window.visualViewport ? window.visualViewport.height : window.innerHeight;
        const canvasH = Math.max(200, vh - ctrlH);
        document.documentElement.style.setProperty("--ctrl-h",   ctrlH   + "px");
        document.documentElement.style.setProperty("--canvas-h", canvasH + "px");
        const cvs = document.getElementById("gameCanvas");
        if (cvs) cvs.style.height = canvasH + "px";
    }
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", setControllerHeight);
    } else {
        setControllerHeight();
    }
    window.addEventListener("resize", setControllerHeight);
    if (window.visualViewport) window.visualViewport.addEventListener("resize", setControllerHeight);
    setTimeout(setControllerHeight, 80);
    setTimeout(setControllerHeight, 400);
    window._setSizing = setControllerHeight;
})();

// =============================================
//  INTRO VIDEO LOGIC  (iOS-safe)
// =============================================
(function () {
    const introPanel = document.getElementById("introPanel");
    const introVideo = document.getElementById("introVideo");
    const skipBtn    = document.getElementById("skipIntroBtn");

    const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (isMobile) skipBtn.textContent = "TAP TO START ▶";

    let introTransitionDone = false;
    function goToHome() {
        if (introTransitionDone) return;
        introTransitionDone = true;
        try { introVideo.pause(); } catch(e) {}
        introPanel.classList.remove("active");
        document.getElementById("homePanel").classList.add("active");
    }

    let videoPlaying = false;
    introVideo.addEventListener("playing", () => { videoPlaying = true; });
    introVideo.addEventListener("ended",   () => { if (videoPlaying) goToHome(); });
    introVideo.addEventListener("error",   () => {});

    const pp = introVideo.play();
    if (pp !== undefined) pp.catch(() => { skipBtn.textContent = "TAP TO START ▶"; });

    skipBtn.addEventListener("click", goToHome);
})();

// =============================================
//  GAME STATE
// =============================================
let gameStarted = false;
let isDecidingTurn = true;
let p1StartRoll = 0, p2StartRoll = 0;
let rollingForPlayer = 1;          // who rolls FIRST when deciding turn order
const ROWS = 20;
const COLS = 6;
let gridNumbers = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
let targetGoal = 0;
let currentTurn = 1, roundP1 = 1, roundP2 = 1, movesThisTurn = 0;
let p1MovedThisRound = false, p2MovedThisRound = false;
let currentOperation = "?";
let needsToRollOp = true, gameOver = false, isPaused = false;

let systemMessage = "";
let waitingForPowerUpChoice = false;
let waitingToRollPowerUp    = false;
let powerUpRecipient = null;
let preRolledPowerUp = "";
let isPowerUpPanelActive = false;

let isTeleportPending = false;
let pendingTeleportDirection = -1;

let p1HasDoubleTile = false;
let p2HasDoubleTile = false;

let gameOverWinner = "";
let gameOverTargetGoal = 0;
let gameOverP1Score = 0;
let gameOverP2Score = 0;

let animationFrames = 0;
let currentDiceImg = null;
let isAnimating    = false;
let isRollingPowerUp = false;

// =============================================
//  ASSET LOADING
//  Operation die has TWO faces: +, -
//  × and / are only accessible via power-up
// =============================================
const images = {};
const assetPaths = {
    gameBg:      'assets/dagat.png',
    island:      'assets/island.png',
    heli:        'assets/helicopter.png',
    scoreBgImg:  'assets/scorebg.png',
    infoBoard:   'assets/ip.png',
    red:         'assets/red.png',
    blue:        'assets/blue.png',
    tp:          'assets/tp.png',
    co:          'assets/co.jpg',
    sx:          'assets/sx.png',
    player1wins: 'assets/player1wins.webp',
    player2wins: 'assets/player2wins.webp'
};

let diceImages    = Array(6);
let opDiceImages  = Array(2);   // 0=add, 1=sub  (× only via power-up)
let powerUpImages = Array(3);

// 12 named assets + 6 number dice + 2 op dice
let totalAssets      = Object.keys(assetPaths).length + 6 + 2;
let loadedAssetsCount = 0;

function checkAllAssetsLoaded() {
    loadedAssetsCount++;
    if (loadedAssetsCount === totalAssets) {
        powerUpImages[0] = images['tp'];
        powerUpImages[1] = images['co'];
        powerUpImages[2] = images['sx'];
    }
    const gamePanel = document.getElementById("activeGamePanel");
    if (gameStarted && !gameOver && gamePanel && gamePanel.classList.contains("active")) {
        requestAnimationFrame(repaintAll);
    }
}

function loadGameAssets() {
    for (let key in assetPaths) {
        images[key] = new Image();
        images[key].src = assetPaths[key];
        images[key].onload  = checkAllAssetsLoaded;
        images[key].onerror = checkAllAssetsLoaded;
    }
    for (let i = 0; i < 6; i++) {
        diceImages[i] = new Image();
        diceImages[i].src = `assets/dice${i + 1}.jpeg`;
        diceImages[i].onload  = checkAllAssetsLoaded;
        diceImages[i].onerror = checkAllAssetsLoaded;
    }
    // Two operation faces: + and -
    const opSrcs = ['assets/op_add.png', 'assets/op_sub.png'];
    for (let i = 0; i < 2; i++) {
        opDiceImages[i] = new Image();
        opDiceImages[i].src = opSrcs[i];
        opDiceImages[i].onload  = checkAllAssetsLoaded;
        opDiceImages[i].onerror = checkAllAssetsLoaded;
    }
}
loadGameAssets();

// =============================================
//  PLAYER CLASS
// =============================================
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
        if (this.timer) { clearInterval(this.timer); this.timer = null; }
    }
}

let p1 = new Player(1, "P1", "red");
let p2 = new Player(4, "P2", "blue");

// =============================================
//  CANVAS — logical coords 0-600 × 0-1080
//  all values multiplied by sx/sy before draw
// =============================================
const canvas = document.getElementById("gameCanvas");
const g2d    = canvas.getContext("2d");

const LW = 600;
const LH = 1080;

function getScale() {
    return { sx: canvas.width / LW, sy: canvas.height / LH,
             pw: canvas.width,       ph: canvas.height };
}

function syncCanvas() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w > 0 && h > 0) { canvas.width = w; canvas.height = h; }
}

// =============================================
//  SCREEN SWITCHING
// =============================================
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    if (id === "activeGamePanel") {
        function waitForSize(attempts) {
            if (window._setSizing) window._setSizing();
            syncCanvas();
            if ((canvas.width > 10 && canvas.height > 100) || attempts <= 0) repaintAll();
            else setTimeout(() => waitForSize(attempts - 1), 50);
        }
        setTimeout(() => waitForSize(20), 30);
    }
}

window.addEventListener("resize", () => {
    syncCanvas();
    if (gameStarted && !gameOver) repaintAll();
});

// =============================================
//  PLAY BUTTON — wait for real canvas size
// =============================================
let playBtnCooldown = false;
document.getElementById("playBtn").addEventListener("click", () => {
    if (playBtnCooldown) return;
    playBtnCooldown = true;
    setTimeout(() => { playBtnCooldown = false; }, 800);
    gameStarted = true;
    showScreen("activeGamePanel");

    function tryStart(tries) {
        if (window._setSizing) window._setSizing();
        syncCanvas();
        if ((canvas.width > 10 && canvas.height > 100) || tries <= 0) {
            resetGame(); window.focus();
        } else {
            requestAnimationFrame(() => tryStart(tries - 1));
        }
    }
    requestAnimationFrame(() => requestAnimationFrame(() =>
        requestAnimationFrame(() => requestAnimationFrame(() => tryStart(30)))));
});

document.getElementById("homeTutBtn").addEventListener("click",  () => showScreen("tutorialPanel"));
document.getElementById("tutBackBtn").addEventListener("click",  () => showScreen("homePanel"));
document.getElementById("homeExitBtn").addEventListener("click", () => window.close());

document.getElementById("gamePauseBtn").addEventListener("click", togglePause);
document.getElementById("resumeBtn").addEventListener("click", resumeGame);
document.getElementById("quitBtn").addEventListener("click", () => {
    resumeGame(); resetGame(); showScreen("homePanel");
});

document.getElementById("rollBtn").addEventListener("click", () => {
    if (!gameOver && !isPaused && !waitingForPowerUpChoice) {
        if (waitingToRollPowerUp) startPowerUpAnimation();
        else if (needsToRollOp)   startDiceAnimation();
    }
});
document.getElementById("rollBtnMobile").addEventListener("click", () => {
    if (!gameOver && !isPaused && !waitingForPowerUpChoice) {
        if (waitingToRollPowerUp) startPowerUpAnimation();
        else if (needsToRollOp)   startDiceAnimation();
    }
});

function setRollButtonsDisabled(en) {
    document.getElementById("rollBtn").disabled = !en;
    const m = document.getElementById("rollBtnMobile");
    if (m) m.disabled = !en;
}

window.addEventListener("keydown", (e) => {
    if (!gameStarted || gameOver || isPaused || isAnimating) return;
    const key = e.key, kl = key.toLowerCase();
    if (["arrowup","arrowleft","arrowright","w","a","d","y","n"].includes(kl)) e.preventDefault();
    if (isPowerUpPanelActive) return;
    if (waitingForPowerUpChoice) {
        if (kl === 'y') applyRandomPowerUp(powerUpRecipient);
        else if (kl === 'n') declinePowerUp();
        return;
    }
    if (isDecidingTurn || needsToRollOp) return;
    handleMovement(key);
    repaintAll();
});

document.getElementById("moveUpBtn").addEventListener("click", () => {
    if (!gameStarted||gameOver||isPaused||isAnimating||isDecidingTurn||needsToRollOp) return;
    handleMovement("ArrowUp"); repaintAll();
});
document.getElementById("moveLeftBtn").addEventListener("click", () => {
    if (!gameStarted||gameOver||isPaused||isAnimating||isDecidingTurn||needsToRollOp) return;
    handleMovement("ArrowLeft"); repaintAll();
});
document.getElementById("moveRightBtn").addEventListener("click", () => {
    if (!gameStarted||gameOver||isPaused||isAnimating||isDecidingTurn||needsToRollOp) return;
    handleMovement("ArrowRight"); repaintAll();
});

document.getElementById("acceptBtn").addEventListener("click", () => {
    if (waitingForPowerUpChoice && powerUpRecipient) applyRandomPowerUp(powerUpRecipient);
});
document.getElementById("declineBtn").addEventListener("click", () => {
    if (waitingForPowerUpChoice && powerUpRecipient) declinePowerUp();
});

function declinePowerUp() {
    systemMessage = "💨 " + powerUpRecipient.name + " DECLINED. Roll Operation!";
    waitingForPowerUpChoice = false;
    powerUpRecipient = null;
    preRolledPowerUp = "";
    currentDiceImg   = null;
    repaintAll();
}

document.getElementById("powerUpOverlay").addEventListener("click", (e) => {
    if (e.target === document.getElementById("powerUpOverlay")) hidePowerUpPanel();
});
document.querySelectorAll(".powerup-btn[data-teleport]").forEach(btn => {
    btn.addEventListener("click", () => handleTeleportChoice(btn.dataset.teleport));
});
document.querySelectorAll(".powerup-btn[data-operator]").forEach(btn => {
    btn.addEventListener("click", () => handleOperatorChoice(btn.dataset.operator));
});
document.getElementById("powerUpCancelBtn").addEventListener("click", () => {
    if (isPowerUpPanelActive) {
        systemMessage = "💨 " + (powerUpRecipient ? powerUpRecipient.name : "Player") + " DECLINED. Roll Operation!";
        hidePowerUpPanel();
        waitingForPowerUpChoice = false;
        powerUpRecipient = null;
        preRolledPowerUp = "";
        currentDiceImg   = null;
        repaintAll();
    }
});

// =============================================
//  TEXT WRAP HELPER
// =============================================
function wrapText(ctx, text, maxWidth) {
    const words = text.split(" ");
    const lines = [];
    let line = "";
    for (let i = 0; i < words.length; i++) {
        const test = line ? line + " " + words[i] : words[i];
        if (ctx.measureText(test).width > maxWidth && line) {
            lines.push(line);
            line = words[i];
        } else {
            line = test;
        }
    }
    if (line) lines.push(line);
    return lines;
}

// =============================================
//  RENDER ENGINE
// =============================================
function repaintAll() {
    syncCanvas();
    const { sx, sy, pw: W, ph: H } = getScale();
    if (W === 0 || H === 0) { requestAnimationFrame(repaintAll); return; }

    g2d.save();
    g2d.setTransform(1, 0, 0, 1, 0, 0);
    g2d.clearRect(0, 0, W, H);
    g2d.fillStyle = "#000";
    g2d.fillRect(0, 0, W, H);

    if (images.gameBg?.complete && images.gameBg.naturalWidth > 0)
        g2d.drawImage(images.gameBg, 0, 0, 600*sx, 1080*sy);
    if (images.island?.complete && images.island.naturalWidth > 0)
        g2d.drawImage(images.island, 75*sx, 0, 450*sx, 280*sy);
    if (images.heli?.complete && images.heli.naturalWidth > 0)
        g2d.drawImage(images.heli, 200*sx, 100*sy, 200*sx, 100*sy);

    drawTargetSign(sx, sy, 240, 195, String(targetGoal));
    drawRoundSign(sx, sy, 240, 250, "ROUND " + ((currentTurn === 1) ? roundP1 : roundP2));

    renderGrid(sx, sy);

    if (!isAnimating) {
        // Only auto-build a prompt when there is genuinely no message yet.
        // Do NOT overwrite result messages (e.g. "P1 rolled 3. P2: ROLL!")
        // just because they happen to contain the word "ROLL".
        if (!systemMessage) {
            if (isDecidingTurn) {
                const pn = (rollingForPlayer === 1) ? "P1" : "P2";
                if (!p1StartRoll && !p2StartRoll)
                    systemMessage = pn + ": ROLL (LOWEST GOES FIRST)";
                else if (p1StartRoll > 0 && !p2StartRoll)
                    systemMessage = "P1 rolled " + p1StartRoll + ". P2: ROLL!";
                else if (p2StartRoll > 0 && !p1StartRoll)
                    systemMessage = "P2 rolled " + p2StartRoll + ". P1: ROLL!";
            } else if (needsToRollOp && !waitingToRollPowerUp) {
                systemMessage = ((currentTurn === 1) ? "P1" : "P2") + ": ROLL OPERATION";
            }
        }
        if (systemMessage) drawInfoBoard(sx, sy, systemMessage);
    }

    if (currentDiceImg?.complete && currentDiceImg.naturalWidth > 0) {
        g2d.drawImage(currentDiceImg, 250*sx, 900*sy, 100*sx, 100*sy);
    }

    drawScoreBoards(sx, sy);
    if (gameOver) drawGameOverScreen(sx, sy);
    g2d.restore();
}

// =============================================
//  INFO BOARD — word-wrapped to stay in border
// =============================================
function drawInfoBoard(sx, sy, message) {
    const bx = 60*sx, by = 330*sy, bw = 480*sx, bh = 160*sy;

    if (images.infoBoard?.complete && images.infoBoard.naturalWidth > 0) {
        g2d.drawImage(images.infoBoard, bx, by, bw, bh);
    } else {
        g2d.fillStyle = "rgba(0,0,0,0.82)";
        g2d.fillRect(bx, by, bw, bh);
    }

    const padX  = 28 * sx;
    const maxTW = bw - padX * 2;
    const scale    = Math.min(sx, sy);
    const baseSize = Math.max(8, 18 * scale);
    const headSize = Math.max(9, 20 * scale);

    g2d.save();
    g2d.textAlign    = "center";
    g2d.textBaseline = "middle";
    g2d.shadowColor  = "rgba(0,0,0,0.95)";
    g2d.shadowBlur   = 4 * scale;
    g2d.shadowOffsetX = 2 * sx;
    g2d.shadowOffsetY = 2 * sy;

    // First pass: collect all wrapped lines
    const allLines = [];
    message.split("\n").forEach((raw, i) => {
        const fs = i === 0 ? headSize : baseSize;
        g2d.font = `bold ${fs}px 'Courier New', monospace`;
        wrapText(g2d, raw, maxTW).forEach(l => allLines.push({ text: l, isHeader: i === 0 }));
    });

    const lineH  = baseSize * 1.55;
    let   curY   = by + (bh - allLines.length * lineH) / 2 + lineH / 2;

    allLines.forEach(({ text, isHeader }) => {
        g2d.fillStyle = isHeader ? "#FFEE44" : "#F0E8C0";
        g2d.font = `bold ${isHeader ? headSize : baseSize}px 'Courier New', monospace`;
        g2d.fillText(text, bx + bw / 2, curY);
        curY += lineH;
    });
    g2d.restore();
}

function renderGrid(sx, sy) {
    const lSY=270, lEY=900, lTW=220, lBW=500, lCX=300;
    const gSY=lSY*sy, gEY=lEY*sy, gCX=lCX*sx;

    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const pT = r/ROWS, pB = (r+1)/ROWS;
            const yT = gSY+pT*(gEY-gSY), yB = gSY+pB*(gEY-gSY);
            const wT = (lTW+pT*(lBW-lTW))*sx, wB = (lTW+pB*(lBW-lTW))*sx;
            const xTL = gCX-wT/2+c*wT/COLS, xTR = gCX-wT/2+(c+1)*wT/COLS;
            const xBL = gCX-wB/2+c*wB/COLS, xBR = gCX-wB/2+(c+1)*wB/COLS;

            g2d.beginPath();
            g2d.moveTo(xTL,yT); g2d.lineTo(xTR,yT);
            g2d.lineTo(xBR,yB); g2d.lineTo(xBL,yB);
            g2d.closePath();

            if (r === 0) {
                g2d.fillStyle   = (c%2===0) ? "#FFF" : "#000";
                g2d.strokeStyle = (c%2===0) ? "#000" : "#FFF";
            } else {
                g2d.fillStyle   = "rgba(0,100,200,0.58)";
                g2d.strokeStyle = "rgba(255,255,255,0.2)";
            }
            g2d.fill(); g2d.stroke();

            if (r !== 0) {
                const fs = Math.max(8, 16*Math.min(sx,sy));
                g2d.fillStyle = "#FFF";
                g2d.font = `bold ${fs}px monospace`;
                g2d.textAlign = "center";
                g2d.textBaseline = "middle";
                g2d.fillText(String(gridNumbers[r][c]), (xTL+xBR)/2, (yT+yB)/2);
            }
        }
    }
    drawPlayerAtPos(sx, sy, p1, lSY, lEY, lTW, lBW, lCX);
    drawPlayerAtPos(sx, sy, p2, lSY, lEY, lTW, lBW, lCX);
}

function drawPlayerAtPos(sx, sy, p, lSY, lEY, lTW, lBW, lCX) {
    const row = Math.min(p.row, ROWS-1);
    const pT=row/ROWS, pB=(row+1)/ROWS;
    const gSY=lSY*sy, gEY=lEY*sy, gCX=lCX*sx;
    const yT=gSY+pT*(gEY-gSY), yB=gSY+pB*(gEY-gSY);
    const wT=(lTW+pT*(lBW-lTW))*sx, wB=(lTW+pB*(lBW-lTW))*sx;
    const xTL=gCX-wT/2+p.col*wT/COLS, xTR=gCX-wT/2+(p.col+1)*wT/COLS;
    const xBL=gCX-wB/2+p.col*wB/COLS, xBR=gCX-wB/2+(p.col+1)*wB/COLS;
    const off = (p.row === ROWS) ? 40*sy : 0;
    drawPlayer(xTL, xTR, xBL, xBR, yT+off, yB+off, images[p.imageKey]);
}

function drawPlayer(xL1, xR1, xL2, xR2, y1, y2, img) {
    if (!img?.complete || img.naturalWidth === 0) return;
    const w = (xR1-xL1+xR2-xL2)/2, h = y2-y1;
    g2d.drawImage(img,
        (xL1+xR1+xL2+xR2)/4 - w*0.4,
        (y1+y2)/2 - h*0.4,
        w*0.8, h*0.8);
}

function drawSign(sx, sy, lx, ly, l1, l2, pc) {
    const x=lx*sx, y=ly*sy, w=180*sx, h=80*sy;
    if (images.scoreBgImg?.complete && images.scoreBgImg.naturalWidth > 0)
        g2d.drawImage(images.scoreBgImg, x, y, w, h);
    else { g2d.fillStyle="#8B4513"; g2d.fillRect(x,y,w,h); }
    const fs1=Math.max(8,20*Math.min(sx,sy)), fs2=Math.max(7,13*Math.min(sx,sy));
    g2d.fillStyle="#FFF"; g2d.font=`bold ${fs1}px 'Courier New'`;
    g2d.textAlign="left"; g2d.textBaseline="alphabetic";
    g2d.fillText(l1, x+20*sx, y+35*sy);
    g2d.font=`${fs2}px Arial`; g2d.fillStyle=pc;
    g2d.fillText(l2, x+20*sx, y+55*sy);
}

function drawTargetSign(sx, sy, lx, ly, text) {
    const x=lx*sx, y=ly*sy, w=120*sx, h=50*sy;
    if (images.scoreBgImg?.complete && images.scoreBgImg.naturalWidth > 0)
        g2d.drawImage(images.scoreBgImg, x, y, w, h);
    else { g2d.fillStyle="#8B4513"; g2d.fillRect(x,y,w,h); }
    const fs=Math.max(12,30*Math.min(sx,sy));
    g2d.fillStyle="#FFFF00"; g2d.font=`bold ${fs}px Arial`;
    g2d.textAlign="center"; g2d.textBaseline="alphabetic";
    g2d.fillText(text, x+w/2, y+35*sy);
}

function drawRoundSign(sx, sy, lx, ly, text) {
    ly -= 10;
    const x=lx*sx, y=ly*sy, w=120*sx, h=30*sy;
    if (images.scoreBgImg?.complete && images.scoreBgImg.naturalWidth > 0)
        g2d.drawImage(images.scoreBgImg, x, y, w, h);
    else { g2d.fillStyle="#654321"; g2d.fillRect(x,y,w,h); }
    const fs=Math.max(8,14*Math.min(sx,sy));
    g2d.fillStyle="#FFF"; g2d.font=`bold ${fs}px Arial`;
    g2d.textAlign="center"; g2d.textBaseline="alphabetic";
    g2d.fillText(text, x+w/2, y+20*sy);
    try {
        const n = parseInt(text.replace(/[^0-9]/g,""));
        if ((n+1) % 3 === 0) {
            const fs2=Math.max(7,12*Math.min(sx,sy));
            g2d.font=`bold ${fs2}px Arial`;
            g2d.fillStyle="rgba(255,69,0,0.75)";
            g2d.fillRect(x-15*sx, y+35*sy, 150*sx, 22*sy);
            g2d.fillStyle="#FFFF00";
            g2d.fillText("⚠️ POWER-UP NEXT!", x+w/2, y+50*sy);
        }
    } catch(e) {}
}

function drawScoreBoards(sx, sy) {
    drawSign(sx, sy, 15,  30, "P1: "+p1.currentTotal, "Time: "+p1.timeLeft, "#FFF");
    drawSign(sx, sy, 405, 30, "P2: "+p2.currentTotal, "Time: "+p2.timeLeft, "#FFF");
}

function drawGameOverScreen(sx, sy) {
    g2d.fillStyle="rgba(0,0,0,0.72)";
    g2d.fillRect(0,0,canvas.width,canvas.height);
    const pi = (gameOverWinner==="PLAYER 1 WINS!") ? images['player1wins']
             : (gameOverWinner==="PLAYER 2 WINS!") ? images['player2wins'] : null;
    const lpx=20, lpy=310, lpw=560, lph=340;
    const ppx=lpx*sx, ppy=lpy*sy, ppw=lpw*sx, pph=lph*sy;
    if (pi?.complete && pi.naturalWidth > 0) {
        g2d.drawImage(pi, ppx, ppy, ppw, pph);
    } else {
        g2d.fillStyle="#2d7a2d"; g2d.fillRect(ppx,ppy,ppw,pph);
        g2d.fillStyle="#6b4423"; g2d.fillRect(ppx+14*sx,ppy+14*sy,ppw-28*sx,pph-28*sy);
        g2d.save(); g2d.textAlign="center";
        const fs=Math.max(18,36*Math.min(sx,sy));
        g2d.font=`bold ${fs}px Arial`;
        g2d.fillStyle="#FFF"; g2d.fillText(gameOverWinner, ppx+ppw/2, ppy+100*sy);
        g2d.restore();
    }
    // Draw values only — labels are already in the win image
    g2d.save();
    g2d.textAlign    = "left";
    g2d.textBaseline = "middle";
    g2d.shadowColor  = "rgba(0,0,0,0.95)";
    g2d.shadowBlur   = 6 * Math.min(sx, sy);
    g2d.shadowOffsetX = 2*sx; g2d.shadowOffsetY = 2*sy;
    const fs = Math.max(10, 20*Math.min(sx,sy));
    g2d.font = `bold ${fs}px 'Courier New',monospace`;
    const valX = ppx + ppw * 0.47;
    const row1Y = ppy + pph * 0.670;
    const row2Y = ppy + pph * 0.740;
    const row3Y = ppy + pph * 0.825;
    g2d.fillStyle = "#FFFF55";
    g2d.fillText(String(gameOverTargetGoal), valX, row1Y);
    g2d.fillStyle = "#FF8888";
    g2d.fillText(String(gameOverP1Score),    valX, row2Y);
    g2d.fillStyle = "#88AAFF";
    g2d.fillText(String(gameOverP2Score),    valX, row3Y);
    g2d.restore();
}

// =============================================
//  GAME LOGIC
// =============================================
function randomizeGrid() {
    for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++)
            gridNumbers[r][c] = Math.floor(Math.random() * 10);
}

function resetGame() {
    p1.stopTimer(); p2.stopTimer();
    p1.row=ROWS; p1.col=1; p1.currentTotal=0; p1.timeLeft=300;
    p2.row=ROWS; p2.col=4; p2.currentTotal=0; p2.timeLeft=300;
    currentTurn=1; roundP1=1; roundP2=1; movesThisTurn=0;
    p1MovedThisRound=false; p2MovedThisRound=false;
    needsToRollOp=true; isDecidingTurn=true;
    p1StartRoll=0; p2StartRoll=0; rollingForPlayer=1;
    gameOver=false; isPaused=false; systemMessage="";
    waitingForPowerUpChoice=false; waitingToRollPowerUp=false;
    powerUpRecipient=null; preRolledPowerUp="";
    isTeleportPending=false; pendingTeleportDirection=-1;
    p1HasDoubleTile=false; p2HasDoubleTile=false;
    currentDiceImg=null;
    gameOverWinner=""; gameOverTargetGoal=0;
    gameOverP1Score=0; gameOverP2Score=0;
    targetGoal=Math.floor(Math.random()*101);
    if (window._setSizing) window._setSizing();
    randomizeGrid(); syncCanvas(); repaintAll();
}

function startDiceAnimation() {
    setRollButtonsDisabled(false);
    isAnimating = true;
    animationFrames = 0;

    // Pre-roll the actual result NOW so the final animation frame
    // always shows the exact face that was rolled — no mismatch possible.
    const preRolledValue = isDecidingTurn
        ? Math.floor(Math.random() * 6) + 1          // d6 for turn order
        : Math.floor(Math.random() * 2);              // 0=add, 1=sub for operation

    const t = setInterval(() => {
        animationFrames++;
        if (animationFrames > 12) {
            clearInterval(t);
            // Lock in the correct face BEFORE finalizeRoll so it never gets stomped
            currentDiceImg = isDecidingTurn
                ? diceImages[preRolledValue - 1]
                : opDiceImages[preRolledValue];
            finalizeRoll(preRolledValue);
            return;
        }
        // Shuffle random faces during animation
        currentDiceImg = isDecidingTurn
            ? diceImages[Math.floor(Math.random() * 6)]
            : opDiceImages[Math.floor(Math.random() * 2)];
        repaintAll();
    }, 80);
}

// =============================================
//  FINALIZE ROLL
//
//  TURN ORDER RULES:
//  • Both players roll the "move die" (d6).
//  • Rolling a 1 → that player goes first INSTANTLY,
//    no need for the other player to roll.
//  • Otherwise lowest roll goes first.
//  • Tie → re-roll; player with MORE time remaining
//    rolls first in the re-roll.
//  • After Round 1: the player with MORE time left
//    rolls the move die first each round.
//
//  OPERATION RULES:
//  • Two possible operations: +, −
//  • × and / are only accessible via power-up.
// =============================================
function finalizeRoll(rv) {
    if (isDecidingTurn) {
        // ── Move-die roll to decide who acts first ──
        // currentDiceImg is already set to the correct face by startDiceAnimation

        if (rollingForPlayer === 1) {
            p1StartRoll = rv;

            // Rolling a 1 → go first instantly, no need for P2 to roll
            if (rv === 1) {
                currentTurn = 1;
                isDecidingTurn = false;
                const cr = roundP1;
                if (cr % 3 === 0) {
                    triggerPowerUpIntegrated();
                } else {
                    systemMessage = "🎯 P1 rolled 1 — goes first! Roll Operation.";
                }
                isAnimating = false;
                setRollButtonsDisabled(true);
                repaintAll();
                return;
            }

            if (p2StartRoll === 0) {
                // P2 hasn't rolled yet
                rollingForPlayer = 2;
                systemMessage = "P1 rolled " + rv + ". P2: ROLL!";
                isAnimating = false;
                setRollButtonsDisabled(true);
                repaintAll();
                return;
            }
        } else {
            p2StartRoll = rv;

            // Rolling a 1 → go first instantly, no need for P1 to roll
            if (rv === 1) {
                currentTurn = 2;
                isDecidingTurn = false;
                const cr = roundP2;
                if (cr % 3 === 0) {
                    triggerPowerUpIntegrated();
                } else {
                    systemMessage = "🎯 P2 rolled 1 — goes first! Roll Operation.";
                }
                isAnimating = false;
                setRollButtonsDisabled(true);
                repaintAll();
                return;
            }

            if (p1StartRoll === 0) {
                // P1 hasn't rolled yet
                rollingForPlayer = 1;
                systemMessage = "P2 rolled " + rv + ". P1: ROLL!";
                isAnimating = false;
                setRollButtonsDisabled(true);
                repaintAll();
                return;
            }
        }

        // Both players have rolled — resolve
        if (p1StartRoll === p2StartRoll) {
            // Tie: reset and re-roll
            // currentDiceImg already shows the tied face (set by startDiceAnimation)
            const tieVal = p1StartRoll;
            p1StartRoll = 0; p2StartRoll = 0;
            rollingForPlayer = (p1.timeLeft >= p2.timeLeft) ? 1 : 2;
            systemMessage = "🎲 TIE (" + tieVal + " vs " + tieVal + ")! Re-roll — lowest goes first.";
        } else {
            // Lowest roll goes first
            // currentDiceImg is already the correct face (set by startDiceAnimation)
            const p1Wins = p1StartRoll < p2StartRoll;
            currentTurn = p1Wins ? 1 : 2;
            isDecidingTurn = false;

            const winner  = p1Wins ? "P1" : "P2";
            const winRoll = p1Wins ? p1StartRoll : p2StartRoll;
            const losRoll = p1Wins ? p2StartRoll : p1StartRoll;

            const cr = (currentTurn === 1) ? roundP1 : roundP2;
            if (cr % 3 === 0) {
                triggerPowerUpIntegrated();
            } else {
                systemMessage = winner + " rolled lowest (" + winRoll + " vs " + losRoll + ")! Roll Operation.";
            }
        }

    } else {
        // ── Operation die: + or − only ──
        // rv here is 0 (add) or 1 (sub), already set as index by startDiceAnimation
        currentOperation = ["+", "-"][rv];
        currentDiceImg   = opDiceImages[rv];
        needsToRollOp    = false;
        systemMessage    = "";
        if (isTeleportPending) executePendingTeleport();
        else { if (currentTurn === 1) p1.startTimer(); else p2.startTimer(); }
    }

    isAnimating = false;
    setRollButtonsDisabled(true);
    repaintAll();
}

function triggerPowerUpIntegrated() {
    powerUpRecipient = (currentTurn === 1) ? p1 : p2;
    const ar = (currentTurn === 1) ? roundP1 : roundP2;
    waitingToRollPowerUp = true;
    needsToRollOp = true;
    systemMessage = "🎰 " + powerUpRecipient.name + " moves first in Round " + ar + "!\nClick 'ROLL' to spin for a Power-Up!";
}

function startPowerUpAnimation() {
    waitingToRollPowerUp = false;
    const pups = ["Teleport", "Operation Changer", "Double", "No Power Up"];
    preRolledPowerUp = pups[Math.floor(Math.random() * pups.length)];
    const ar = (currentTurn === 1) ? roundP1 : roundP2;
    isRollingPowerUp = true; isAnimating = true;
    setRollButtonsDisabled(false);
    let frames = 0;
    const pt = setInterval(() => {
        frames++;
        if (frames <= 14) {
            currentDiceImg = images[["tp","co","sx"][Math.floor(Math.random()*3)]];
            repaintAll();
        } else {
            clearInterval(pt);
            isRollingPowerUp = false; isAnimating = false;
            setRollButtonsDisabled(true);
            if (preRolledPowerUp === "No Power Up") {
                systemMessage = "👑 " + powerUpRecipient.name + " moves first in Round " + ar + "!\n💨 NO POWER UP. Roll Operation to continue.";
                waitingForPowerUpChoice = false;
                powerUpRecipient = null; preRolledPowerUp = ""; currentDiceImg = null;
            } else {
                if      (preRolledPowerUp === "Teleport")           currentDiceImg = images['tp'];
                else if (preRolledPowerUp === "Operation Changer")  currentDiceImg = images['co'];
                else if (preRolledPowerUp === "Double")             currentDiceImg = images['sx'];
                systemMessage = powerUpRecipient.name + " moves first in Round " + ar + "!\nRolled: " + preRolledPowerUp + "\nPress Y to accept, N to decline.";
                waitingForPowerUpChoice = true;
            }
            repaintAll();
        }
    }, 80);
}

function togglePause() {
    isPaused = true;
    p1.stopTimer(); p2.stopTimer();
    document.getElementById("pauseOverlay").style.display = "flex";
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
    p1.stopTimer(); p2.stopTimer();
    movesThisTurn = 0;
    if (currentTurn === 1) { p1MovedThisRound = true; roundP1++; currentTurn = 2; }
    else                   { p2MovedThisRound = true; roundP2++; currentTurn = 1; }

    if (p1MovedThisRound && p2MovedThisRound) {
        // Both players have moved — start a new round
        p1MovedThisRound = false; p2MovedThisRound = false;
        isDecidingTurn = true; needsToRollOp = true;
        p1StartRoll = 0; p2StartRoll = 0; currentOperation = "?";
        currentDiceImg = null;   // clear die so nothing bleeds into the new round
        // Player with MORE time remaining rolls the move die first
        rollingForPlayer = (p1.timeLeft >= p2.timeLeft) ? 1 : 2;
        systemMessage = "";
    } else {
        // Second player still needs to move this round
        needsToRollOp = true;
        const nr = (currentTurn === 1) ? roundP1 : roundP2;
        systemMessage = (nr % 3 === 0) ? "⚠️ INCOMING POWER-UP ROUND!" : "";
    }
    repaintAll();
}

function executePendingTeleport() {
    isTeleportPending = false;
    const rec = (currentTurn === 1) ? p1 : p2;
    let tr = rec.row, tc = rec.col;
    if      (pendingTeleportDirection === 0) tc -= 2;
    else if (pendingTeleportDirection === 1) tr -= 2;
    else if (pendingTeleportDirection === 2) tc += 2;

    if (tr >= 0 && tr <= ROWS && tc >= 0 && tc < COLS) {
        rec.row = tr; rec.col = tc;
        if (rec.row === 0) { repaintAll(); checkWinCondition(); return; }
        if (rec.row < ROWS) {
            let tv = gridNumbers[rec.row][rec.col];
            const ar = (currentTurn === 1) ? roundP1 : roundP2;
            const hd = (currentTurn === 1) ? p1HasDoubleTile : p2HasDoubleTile;
            if (hd) {
                tv *= 2;
                if (currentTurn === 1) p1HasDoubleTile = false; else p2HasDoubleTile = false;
            }
            if (ar === 1 && movesThisTurn === 0) rec.currentTotal = tv;
            else applyOperation(rec, tv);
        }
        systemMessage = "🌀 Teleported! Operator: " + currentOperation;
    } else {
        systemMessage = "🌀 Teleport failed — out of bounds.";
    }

    movesThisTurn++;
    const ar = (currentTurn === 1) ? roundP1 : roundP2;
    // Round 1: need 2 moves; all later rounds: 1 move per turn
    if (ar === 1) {
        if (movesThisTurn === 2) endTurn();
        else if (!gameOver) { if (currentTurn === 1) p1.startTimer(); else p2.startTimer(); }
    } else {
        if (movesThisTurn === 1) endTurn();
        else if (!gameOver) { if (currentTurn === 1) p1.startTimer(); else p2.startTimer(); }
    }
    repaintAll();
}

// =============================================
//  HANDLE MOVEMENT
//  Round 1  → player moves 2 tiles, first tile
//             SETS total (no operation applied).
//  Round 2+ → player moves 1 tile per turn,
//             operation always applied.
// =============================================
function handleMovement(key) {
    const act = (currentTurn === 1) ? p1 : p2;
    const ar  = (currentTurn === 1) ? roundP1 : roundP2;
    let tr = act.row, tc = act.col;

    if      (key === "ArrowUp"    || key === "w" || key === "W") tr--;
    else if (key === "ArrowLeft"  || key === "a" || key === "A") tc--;
    else if (key === "ArrowRight" || key === "d" || key === "D") tc++;
    else return;

    if (tr < 0 || tr > ROWS || tc < 0 || tc >= COLS) return;
    act.row = tr; act.col = tc;

    if (act.row === 0) { repaintAll(); checkWinCondition(); return; }

    let tv = gridNumbers[act.row][act.col];
    const hd = (currentTurn === 1) ? p1HasDoubleTile : p2HasDoubleTile;
    if (hd) {
        tv *= 2;
        if (currentTurn === 1) p1HasDoubleTile = false; else p2HasDoubleTile = false;
    }

    // Round 1, first move: set total directly (no operation)
    if (ar === 1 && movesThisTurn === 0) act.currentTotal = tv;
    else applyOperation(act, tv);

    movesThisTurn++;

    // Round 1 requires 2 moves; subsequent rounds require 1
    if (ar === 1) { if (movesThisTurn === 2) endTurn(); }
    else          { if (movesThisTurn === 1) endTurn(); }
}

function applyRandomPowerUp(rec) {
    waitingForPowerUpChoice = false;
    if (preRolledPowerUp === "Teleport")          { showTeleportPanel(rec);  return; }
    if (preRolledPowerUp === "Operation Changer") { showOperationPanel(rec); return; }
    if (preRolledPowerUp === "Double") {
        if (rec === p1) p1HasDoubleTile = true; else p2HasDoubleTile = true;
        systemMessage = "🎉 " + rec.name + " accepted DOUBLE!\nNext tile value doubled. Roll operation.";
    }
    preRolledPowerUp = ""; powerUpRecipient = null; currentDiceImg = null;
    repaintAll();
}

function showTeleportPanel(rec) {
    powerUpRecipient = rec; waitingForPowerUpChoice = false; isPowerUpPanelActive = true;
    document.getElementById("powerUpOverlay").style.display = "block";
    document.getElementById("teleportPanel").style.display  = "block";
    document.getElementById("operatorPanel").style.display  = "none";
}
function showOperationPanel(rec) {
    powerUpRecipient = rec; waitingForPowerUpChoice = false; isPowerUpPanelActive = true;
    document.getElementById("powerUpOverlay").style.display = "block";
    document.getElementById("teleportPanel").style.display  = "none";
    document.getElementById("operatorPanel").style.display  = "block";
}
function hidePowerUpPanel() {
    isPowerUpPanelActive = false;
    document.getElementById("powerUpOverlay").style.display = "none";
}

function handleTeleportChoice(choice) {
    let dir = 1, dn = "TOP";
    if (choice === "L") { dir = 0; dn = "LEFT"; }
    else if (choice === "R") { dir = 2; dn = "RIGHT"; }
    pendingTeleportDirection = dir; isTeleportPending = true; currentDiceImg = null;
    systemMessage = "🌀 Teleport " + dn + " locked!\nClick 'ROLL' for your operation.";
    preRolledPowerUp = ""; powerUpRecipient = null;
    hidePowerUpPanel(); repaintAll();
}

function handleOperatorChoice(choice) {
    if (!["+", "-", "*", "/"].includes(choice)) choice = "+";
    currentOperation = choice; currentDiceImg = null; needsToRollOp = false;
    waitingForPowerUpChoice = false; preRolledPowerUp = ""; powerUpRecipient = null;
    systemMessage = "";
    hidePowerUpPanel();
    if (currentTurn === 1) p1.startTimer(); else p2.startTimer();
    repaintAll();
}

// =============================================
//  APPLY OPERATION  (+, −, ×, /)
//  × and / are only reachable via power-up
// =============================================
function applyOperation(player, tv) {
    if      (currentOperation === "+") player.currentTotal += tv;
    else if (currentOperation === "-") player.currentTotal -= tv;
    else if (currentOperation === "*") player.currentTotal *= tv;
    else if (currentOperation === "/") {
        if (tv !== 0) player.currentTotal = Math.trunc(player.currentTotal / tv);
    }
}

function checkWinCondition() {
    gameOver = true;
    p1.stopTimer(); p2.stopTimer();
    const d1 = Math.abs(targetGoal - p1.currentTotal);
    const d2 = Math.abs(targetGoal - p2.currentTotal);
    let w = "IT'S A TIE!";
    if (d1 < d2) w = "PLAYER 1 WINS!";
    else if (d2 < d1) w = "PLAYER 2 WINS!";
    gameOverWinner    = w;
    gameOverTargetGoal = targetGoal;
    gameOverP1Score   = p1.currentTotal;
    gameOverP2Score   = p2.currentTotal;
    repaintAll();
}
