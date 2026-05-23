// =============================================
//  MOBILE CANVAS HEIGHT FIX
//  Must run before anything else so the canvas
//  has a real height when the game screen opens.
// =============================================
(function mobileSizing() {
    function setControllerHeight() {
        if (window.innerWidth > 768) return;

        const ctrl = document.getElementById("mobileControls");
        // getBoundingClientRect is 0 before the element is visible,
        // so we also use the CSS formula as a reliable fallback.
        const measured = ctrl ? ctrl.getBoundingClientRect().height : 0;
        const ctrlH = measured > 10
            ? measured
            : Math.min(302, Math.max(180, window.innerWidth / 1.988));

        document.documentElement.style.setProperty("--ctrl-h", ctrlH + "px");

        const cvs = document.getElementById("gameCanvas");
        if (cvs) {
            cvs.style.height = Math.max(200, window.innerHeight - ctrlH) + "px";
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", setControllerHeight);
    } else {
        setControllerHeight();
    }

    window.addEventListener("resize", setControllerHeight);
    // Delay handles mobile Chrome hiding the address bar after load
    setTimeout(setControllerHeight, 80);
    setTimeout(setControllerHeight, 400);

    window._setSizing = setControllerHeight;
})();

// =============================================
//  INTRO VIDEO LOGIC
// =============================================
(function () {
    const introPanel = document.getElementById("introPanel");
    const introVideo = document.getElementById("introVideo");
    const skipBtn    = document.getElementById("skipIntroBtn");

    function goToHome() {
        introVideo.pause();
        skipBtn.style.display = "none";
        introPanel.classList.remove("active");
        document.getElementById("homePanel").classList.add("active");
    }

    introVideo.play().catch(() => {
        skipBtn.textContent = "TAP TO START ▶";
    });

    introVideo.addEventListener("ended", goToHome);
    skipBtn.addEventListener("click", goToHome);
})();

// =============================================
//  GAME STATE
// =============================================
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

let systemMessage = "";
let waitingForPowerUpChoice = false;
let waitingToRollPowerUp = false;
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
let isAnimating = false;
let isRollingPowerUp = false;

// =============================================
//  ASSET LOADING
// =============================================
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
    sx: 'assets/sx.png',
    player1wins: 'assets/player1wins.webp',
    player2wins: 'assets/player2wins.webp'
};

let diceImages = Array(6);
let opDiceImages = Array(2);
let powerUpImages = Array(3);
let totalAssets = Object.keys(assetPaths).length + 6 + 2;
let loadedAssetsCount = 0;

function checkAllAssetsLoaded() {
    loadedAssetsCount++;
    if (loadedAssetsCount === totalAssets) {
        powerUpImages[0] = images['tp'];
        powerUpImages[1] = images['co'];
        powerUpImages[2] = images['sx'];
    }
}

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
//  CANVAS SCALING
// =============================================
const canvas = document.getElementById("gameCanvas");
const g2d = canvas.getContext("2d");

function syncCanvasResolution() {
    const cssW = canvas.clientWidth  || 600;
    const cssH = canvas.clientHeight || 1080;
    if (canvas.width !== cssW || canvas.height !== cssH) {
        canvas.width  = cssW;
        canvas.height = cssH;
    }
}

function applyScale() {
    g2d.setTransform(canvas.width / 600, 0, 0, canvas.height / 1080, 0, 0);
}

function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const target = document.getElementById(id);
    target.classList.add('active');
    // After switching to the game screen the controller becomes visible —
    // measure it now so the canvas height is correct before the first paint.
    if (id === "activeGamePanel" && window._setSizing) {
        // rAF ensures the browser has laid out the newly visible elements
        requestAnimationFrame(() => {
            window._setSizing();
            requestAnimationFrame(() => window._setSizing());
        });
    }
}

window.addEventListener("resize", () => {
    if (gameStarted && !gameOver && !isPaused) repaintAll();
});

// =============================================
//  EVENT LISTENERS
// =============================================
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
    resumeGame(); resetGame(); showScreen("homePanel");
});

document.getElementById("rollBtn").addEventListener("click", () => {
    if (!gameOver && !isPaused && !waitingForPowerUpChoice) {
        if (waitingToRollPowerUp) startPowerUpAnimation();
        else if (needsToRollOp) startDiceAnimation();
    }
});
document.getElementById("rollBtnMobile").addEventListener("click", () => {
    if (!gameOver && !isPaused && !waitingForPowerUpChoice) {
        if (waitingToRollPowerUp) startPowerUpAnimation();
        else if (needsToRollOp) startDiceAnimation();
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
        else if (kl === 'n') {
            systemMessage = "💨 " + powerUpRecipient.name + " DECLINED. Roll Operation!";
            waitingForPowerUpChoice = false; powerUpRecipient = null;
            preRolledPowerUp = ""; currentDiceImg = null; repaintAll();
        }
        return;
    }
    if (isDecidingTurn || needsToRollOp) return;
    handleMovement(key); repaintAll();
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
    if (waitingForPowerUpChoice && powerUpRecipient) {
        systemMessage = "💨 " + powerUpRecipient.name + " DECLINED. Roll Operation!";
        waitingForPowerUpChoice = false; powerUpRecipient = null;
        preRolledPowerUp = ""; currentDiceImg = null; repaintAll();
    }
});

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
        hidePowerUpPanel(); waitingForPowerUpChoice = false; powerUpRecipient = null;
        preRolledPowerUp = ""; currentDiceImg = null; repaintAll();
    }
});

// =============================================
//  RENDER ENGINE
// =============================================
function repaintAll() {
    syncCanvasResolution();
    applyScale();

    g2d.clearRect(0, 0, 600, 1080);
    g2d.fillStyle = "#000"; g2d.fillRect(0, 0, 600, 1080);

    if (images.gameBg?.complete)    g2d.drawImage(images.gameBg, 0, 0, 600, 1080);
    if (images.island?.complete)    g2d.drawImage(images.island, 75, 0, 450, 280);
    if (images.heli?.complete)      g2d.drawImage(images.heli, 200, 100, 200, 100);

    drawTargetSign(g2d, 240, 195, String(targetGoal));
    drawRoundSign(g2d, 240, 250, "ROUND " + ((currentTurn === 1) ? roundP1 : roundP2));

    renderGrid(g2d);

    if (!isAnimating) {
        if (!systemMessage || systemMessage.includes("ROLL")) {
            if (isDecidingTurn) {
                let pn = (rollingForPlayer === 1) ? "P1" : "P2";
                if (!p1StartRoll && !p2StartRoll)         systemMessage = pn + ": ROLL TO START";
                else if (p1StartRoll > 0 && !p2StartRoll) systemMessage = "P1 rolled " + p1StartRoll + ". P2 ROLL!";
                else if (p2StartRoll > 0 && !p1StartRoll) systemMessage = "P2 rolled " + p2StartRoll + ". P1 ROLL!";
            } else if (needsToRollOp && !waitingToRollPowerUp) {
                systemMessage = ((currentTurn === 1) ? "P1" : "P2") + ": ROLL OPERATION";
            }
        }
        if (systemMessage) {
            g2d.fillStyle = "rgba(0,0,0,0.78)"; g2d.fillRect(40, 340, 520, 140);
            g2d.fillStyle = "#FFFF00";
            if (systemMessage.includes("\n")) {
                g2d.font = "bold 16px Arial";
                let lines = systemMessage.split("\n"), y = 365;
                lines.forEach(ln => { g2d.fillText(ln, (600 - g2d.measureText(ln).width) / 2, y); y += 25; });
            } else {
                g2d.font = "bold 20px Arial";
                g2d.fillText(systemMessage, (600 - g2d.measureText(systemMessage).width) / 2, 420);
            }
        }
    }

    if (currentDiceImg?.complete) g2d.drawImage(currentDiceImg, 250, 900, 100, 100);
    drawScoreBoards(g2d);
    if (gameOver) drawGameOverScreen(g2d);
}

function renderGrid(g2d) {
    const sy = 270, ey = 900, tw = 220, bw = 500, cx = 300;
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            let pT = r/ROWS, pB = (r+1)/ROWS;
            let yT = sy + pT*(ey-sy), yB = sy + pB*(ey-sy);
            let wT = tw + pT*(bw-tw), wB = tw + pB*(bw-tw);
            let xTL = cx-wT/2+c*wT/COLS, xTR = cx-wT/2+(c+1)*wT/COLS;
            let xBL = cx-wB/2+c*wB/COLS, xBR = cx-wB/2+(c+1)*wB/COLS;
            g2d.beginPath();
            g2d.moveTo(xTL,yT); g2d.lineTo(xTR,yT); g2d.lineTo(xBR,yB); g2d.lineTo(xBL,yB);
            g2d.closePath();
            if (r === 0) {
                g2d.fillStyle   = (c%2===0)?"#FFF":"#000";
                g2d.strokeStyle = (c%2===0)?"#000":"#FFF";
            } else {
                g2d.fillStyle   = "rgba(0,100,200,0.58)";
                g2d.strokeStyle = "rgba(255,255,255,0.2)";
            }
            g2d.fill(); g2d.stroke();
            if (r !== 0) {
                g2d.fillStyle = "#FFF"; g2d.font = "bold 16px Monospaced";
                g2d.fillText(String(gridNumbers[r][c]), (xTL+xBR)/2-5, (yT+yB)/2+5);
            }
        }
    }
    drawPlayerAtPos(g2d, p1, sy, ey, tw, bw, cx);
    drawPlayerAtPos(g2d, p2, sy, ey, tw, bw, cx);
}

function drawPlayerAtPos(g2d, p, sy, ey, tw, bw, cx) {
    let row = Math.min(p.row, ROWS-1);
    let pT = row/ROWS, pB = (row+1)/ROWS;
    let yT = sy+pT*(ey-sy), yB = sy+pB*(ey-sy);
    let wT = tw+pT*(bw-tw), wB = tw+pB*(bw-tw);
    let xTL = cx-wT/2+p.col*wT/COLS, xTR = cx-wT/2+(p.col+1)*wT/COLS;
    let xBL = cx-wB/2+p.col*wB/COLS, xBR = cx-wB/2+(p.col+1)*wB/COLS;
    let off = (p.row===ROWS)?40:0;
    drawPlayer(g2d, xTL, xTR, xBL, xBR, yT+off, yB+off, images[p.imageKey]);
}

function drawPlayer(g2d, xL1, xR1, xL2, xR2, y1, y2, img) {
    if (!img?.complete) return;
    let w=(xR1-xL1+xR2-xL2)/2, h=y2-y1;
    g2d.drawImage(img, (xL1+xR1+xL2+xR2)/4-w*0.4, (y1+y2)/2-h*0.4, w*0.8, h*0.8);
}

function drawSign(g2d, x, y, l1, l2, pc) {
    if (images.scoreBgImg?.complete) g2d.drawImage(images.scoreBgImg, x, y, 180, 80);
    else { g2d.fillStyle="#8B4513"; g2d.fillRect(x,y,180,80); }
    g2d.fillStyle="#FFF"; g2d.font="bold 20px Courier New"; g2d.fillText(l1,x+20,y+35);
    g2d.font="13px Arial"; g2d.fillStyle=pc; g2d.fillText(l2,x+20,y+55);
}

function drawTargetSign(g2d, x, y, text) {
    if (images.scoreBgImg?.complete) g2d.drawImage(images.scoreBgImg, x, y, 120, 50);
    else { g2d.fillStyle="#8B4513"; g2d.fillRect(x,y,120,50); }
    g2d.fillStyle="#FFFF00"; g2d.font="bold 30px Arial";
    g2d.fillText(text, x+60-g2d.measureText(text).width/2, y+35);
}

function drawRoundSign(g2d, x, y, text) {
    y -= 10;
    if (images.scoreBgImg?.complete) g2d.drawImage(images.scoreBgImg, x, y, 120, 30);
    else { g2d.fillStyle="#654321"; g2d.fillRect(x,y,120,30); }
    g2d.fillStyle="#FFF"; g2d.font="bold 14px Arial";
    g2d.fillText(text, x+60-g2d.measureText(text).width/2, y+20);
    try {
        let n = parseInt(text.replace(/[^0-9]/g,""));
        if ((n+1)%3===0) {
            let wt="⚠️ POWER-UP NEXT!"; g2d.font="bold 12px Arial";
            g2d.fillStyle="rgba(255,69,0,0.75)"; g2d.fillRect(x-15,y+35,150,22);
            g2d.fillStyle="#FFFF00"; g2d.fillText(wt, x+60-g2d.measureText(wt).width/2, y+50);
        }
    } catch(e){}
}

function drawScoreBoards(g2d) {
    drawSign(g2d,15,30,"P1: "+p1.currentTotal,"Time: "+p1.timeLeft,"#FFF");
    drawSign(g2d,405,30,"P2: "+p2.currentTotal,"Time: "+p2.timeLeft,"#FFF");
}

function drawGameOverScreen(g2d) {
    g2d.fillStyle="rgba(0,0,0,0.72)"; g2d.fillRect(0,0,600,1080);
    let pi=(gameOverWinner==="PLAYER 1 WINS!")?images['player1wins']
          :(gameOverWinner==="PLAYER 2 WINS!")?images['player2wins']:null;
    let pw=560,ph=340,px=20,py=310;
    if (pi?.complete && pi.naturalWidth>0) { g2d.drawImage(pi,px,py,pw,ph); }
    else {
        g2d.fillStyle="#2d7a2d"; g2d.fillRect(px,py,pw,ph);
        g2d.fillStyle="#6b4423"; g2d.fillRect(px+14,py+14,pw-28,ph-28);
        g2d.save(); g2d.textAlign="center"; g2d.font="bold 36px Arial";
        g2d.fillStyle="#FFF"; g2d.fillText(gameOverWinner,px+pw/2,py+100); g2d.restore();
    }
    g2d.save(); g2d.textAlign="left";
    g2d.shadowColor="rgba(0,0,0,0.95)"; g2d.shadowBlur=6; g2d.shadowOffsetX=2; g2d.shadowOffsetY=2;
    g2d.font="bold 22px 'Courier New',monospace";
    g2d.fillStyle="#FFFF55"; g2d.fillText(String(gameOverTargetGoal),px+185,py+ph*0.665);
    g2d.fillStyle="#FF8888"; g2d.fillText(String(gameOverP1Score),   px+185,py+ph*0.760);
    g2d.fillStyle="#88AAFF"; g2d.fillText(String(gameOverP2Score),   px+185,py+ph*0.855);
    g2d.restore();
}

// =============================================
//  GAME LOGIC
// =============================================
function randomizeGrid() {
    for (let r=0;r<ROWS;r++) for (let c=0;c<COLS;c++)
        gridNumbers[r][c]=Math.floor(Math.random()*10);
}

function resetGame() {
    p1.stopTimer(); p2.stopTimer();
    p1.row=ROWS;p1.col=1;p1.currentTotal=0;p1.timeLeft=300;
    p2.row=ROWS;p2.col=4;p2.currentTotal=0;p2.timeLeft=300;
    currentTurn=1;roundP1=1;roundP2=1;movesThisTurn=0;
    p1MovedThisRound=false;p2MovedThisRound=false;
    needsToRollOp=true;isDecidingTurn=true;
    p1StartRoll=0;p2StartRoll=0;rollingForPlayer=1;
    gameOver=false;isPaused=false;systemMessage="";
    waitingForPowerUpChoice=false;waitingToRollPowerUp=false;
    powerUpRecipient=null;preRolledPowerUp="";
    isTeleportPending=false;pendingTeleportDirection=-1;
    p1HasDoubleTile=false;p2HasDoubleTile=false;
    currentDiceImg=null;
    gameOverWinner="";gameOverTargetGoal=0;gameOverP1Score=0;gameOverP2Score=0;
    targetGoal=Math.floor(Math.random()*101);
    // Re-measure controller now that the game screen is active
    if (window._setSizing) window._setSizing();
    randomizeGrid(); repaintAll();
}

function startDiceAnimation() {
    setRollButtonsDisabled(false); isAnimating=true; animationFrames=0;
    let t=setInterval(()=>{
        animationFrames++;
        currentDiceImg=isDecidingTurn?diceImages[Math.floor(Math.random()*6)]:opDiceImages[Math.floor(Math.random()*2)];
        repaintAll();
        if (animationFrames>12){clearInterval(t);finalizeRoll();}
    },80);
}

function finalizeRoll() {
    if (isDecidingTurn) {
        let rv=Math.floor(Math.random()*6)+1, or=(rollingForPlayer===1)?roundP1:roundP2;
        if (rollingForPlayer===1) {
            p1StartRoll=rv;
            if (or>1&&rv===1){p2StartRoll=-1;systemMessage="🎲 P1 rolled 1 in Round "+or+"! Moving first.";}
            else if (p2StartRoll===0) rollingForPlayer=2;
        } else {
            p2StartRoll=rv;
            if (or>1&&rv===1){p1StartRoll=-1;systemMessage="🎲 P2 rolled 1 in Round "+or+"! Moving first.";}
            else if (p1StartRoll===0) rollingForPlayer=1;
        }
        if (p1StartRoll!==0&&p2StartRoll!==0) {
            if (p1StartRoll===p2StartRoll&&p1StartRoll>0){
                p1StartRoll=0;p2StartRoll=0;rollingForPlayer=(p1.timeLeft>=p2.timeLeft)?1:2;
            } else {
                currentTurn=(p1StartRoll<p2StartRoll)?1:2; isDecidingTurn=false;
                let cr=(currentTurn===1)?roundP1:roundP2;
                if (cr%3===0) triggerPowerUpIntegrated();
                else systemMessage="Player "+currentTurn+" moves first! Roll Operation.";
            }
        }
    } else {
        let or=Math.floor(Math.random()*2);
        currentOperation=(or===0)?"+":"-"; currentDiceImg=opDiceImages[or];
        needsToRollOp=false; systemMessage="";
        if (isTeleportPending) executePendingTeleport();
        else { if (currentTurn===1) p1.startTimer(); else p2.startTimer(); }
    }
    isAnimating=false; setRollButtonsDisabled(true); repaintAll();
}

function triggerPowerUpIntegrated() {
    powerUpRecipient=(currentTurn===1)?p1:p2;
    let ar=(currentTurn===1)?roundP1:roundP2;
    waitingToRollPowerUp=true; needsToRollOp=true;
    systemMessage="🎰 "+powerUpRecipient.name+" moves first in Round "+ar+"!\nClick 'ROLL' to spin for a Power-Up!";
}

function startPowerUpAnimation() {
    waitingToRollPowerUp=false;
    let pups=["Teleport","Operation Changer","Double","No Power Up"];
    preRolledPowerUp=pups[Math.floor(Math.random()*pups.length)];
    let ar=(currentTurn===1)?roundP1:roundP2;
    isRollingPowerUp=true; isAnimating=true; setRollButtonsDisabled(false);
    let frames=0, pt=setInterval(()=>{
        frames++;
        if (frames<=14){
            let k=["tp","co","sx"]; currentDiceImg=images[k[Math.floor(Math.random()*k.length)]]; repaintAll();
        } else {
            clearInterval(pt); isRollingPowerUp=false; isAnimating=false; setRollButtonsDisabled(true);
            if (preRolledPowerUp==="No Power Up"){
                systemMessage="👑 "+powerUpRecipient.name+" moves first in Round "+ar+"!\n💨 NO POWER UP. Roll Operation to continue.";
                waitingForPowerUpChoice=false;powerUpRecipient=null;preRolledPowerUp="";currentDiceImg=null;
            } else {
                if (preRolledPowerUp==="Teleport") currentDiceImg=images['tp'];
                else if (preRolledPowerUp==="Operation Changer") currentDiceImg=images['co'];
                else if (preRolledPowerUp==="Double") currentDiceImg=images['sx'];
                systemMessage=powerUpRecipient.name+" moves first in Round "+ar+"!\nRolled: "+preRolledPowerUp+"\nPress Y to accept, N to decline.";
                waitingForPowerUpChoice=true;
            }
            repaintAll();
        }
    },80);
}

function togglePause() {
    isPaused=true; p1.stopTimer(); p2.stopTimer();
    const overlay = document.getElementById("pauseOverlay");
    overlay.style.display = "flex";
}

function resumeGame() {
    isPaused=false;
    document.getElementById("pauseOverlay").style.display="none";
    if (!needsToRollOp&&!gameOver&&!isDecidingTurn){
        if (currentTurn===1) p1.startTimer(); else p2.startTimer();
    }
    repaintAll();
}

function endTurn() {
    p1.stopTimer(); p2.stopTimer(); movesThisTurn=0;
    if (currentTurn===1){p1MovedThisRound=true;roundP1++;currentTurn=2;}
    else{p2MovedThisRound=true;roundP2++;currentTurn=1;}
    if (p1MovedThisRound&&p2MovedThisRound){
        p1MovedThisRound=false;p2MovedThisRound=false;
        isDecidingTurn=true;needsToRollOp=true;
        p1StartRoll=0;p2StartRoll=0;currentOperation="?";
        rollingForPlayer=(p1.timeLeft>=p2.timeLeft)?1:2; systemMessage="";
    } else {
        needsToRollOp=true;
        let nr=(currentTurn===1)?roundP1:roundP2;
        systemMessage=(nr%3===0)?"⚠️ INCOMING POWER-UP ROUND!":"";
    }
    repaintAll();
}

function executePendingTeleport() {
    isTeleportPending=false;
    let rec=(currentTurn===1)?p1:p2, tr=rec.row, tc=rec.col;
    if (pendingTeleportDirection===0) tc-=2;
    else if (pendingTeleportDirection===1) tr-=2;
    else if (pendingTeleportDirection===2) tc+=2;
    if (tr>=0&&tr<=ROWS&&tc>=0&&tc<COLS){
        rec.row=tr;rec.col=tc;
        if (rec.row===0){repaintAll();checkWinCondition();return;}
        if (rec.row<ROWS){
            let tv=gridNumbers[rec.row][rec.col];
            let ar=(currentTurn===1)?roundP1:roundP2;
            let hd=(currentTurn===1)?p1HasDoubleTile:p2HasDoubleTile;
            if(hd){tv*=2;if(currentTurn===1)p1HasDoubleTile=false;else p2HasDoubleTile=false;}
            if(ar===1&&movesThisTurn===0)rec.currentTotal=tv; else applyOperation(rec,tv);
        }
        systemMessage="🌀 Teleported! Operator: "+currentOperation;
    } else { systemMessage="🌀 Teleport failed! Out of map bounds."; }
    movesThisTurn++;
    let ar=(currentTurn===1)?roundP1:roundP2;
    if(ar===1){if(movesThisTurn===2)endTurn();else if(!gameOver){if(currentTurn===1)p1.startTimer();else p2.startTimer();}}
    else{if(movesThisTurn===1)endTurn();else if(!gameOver){if(currentTurn===1)p1.startTimer();else p2.startTimer();}}
    repaintAll();
}

function handleMovement(key) {
    let act=(currentTurn===1)?p1:p2, ar=(currentTurn===1)?roundP1:roundP2;
    let tr=act.row, tc=act.col;
    if(key==="ArrowUp"||key==="w"||key==="W")tr--;
    else if(key==="ArrowLeft"||key==="a"||key==="A")tc--;
    else if(key==="ArrowRight"||key==="d"||key==="D")tc++;
    else return;
    if(tr<0||tr>ROWS||tc<0||tc>=COLS)return;
    act.row=tr;act.col=tc;
    if(act.row===0){repaintAll();checkWinCondition();return;}
    let tv=gridNumbers[act.row][act.col];
    let hd=(currentTurn===1)?p1HasDoubleTile:p2HasDoubleTile;
    if(hd){tv*=2;if(currentTurn===1)p1HasDoubleTile=false;else p2HasDoubleTile=false;}
    if(ar===1&&movesThisTurn===0)act.currentTotal=tv; else applyOperation(act,tv);
    movesThisTurn++;
    if(ar===1){if(movesThisTurn===2)endTurn();}
    else{if(movesThisTurn===1)endTurn();}
}

function applyRandomPowerUp(rec) {
    waitingForPowerUpChoice=false;
    if(preRolledPowerUp==="Teleport"){showTeleportPanel(rec);return;}
    if(preRolledPowerUp==="Operation Changer"){showOperationPanel(rec);return;}
    if(preRolledPowerUp==="Double"){
        if(rec===p1)p1HasDoubleTile=true;else p2HasDoubleTile=true;
        systemMessage="🎉 "+rec.name+" accepted DOUBLE! Next tile value doubled. Roll operation.";
    }
    preRolledPowerUp="";powerUpRecipient=null;currentDiceImg=null;repaintAll();
}

function showTeleportPanel(rec) {
    powerUpRecipient=rec;waitingForPowerUpChoice=false;isPowerUpPanelActive=true;
    document.getElementById("powerUpOverlay").style.display="block";
    document.getElementById("teleportPanel").style.display="block";
    document.getElementById("operatorPanel").style.display="none";
}
function showOperationPanel(rec) {
    powerUpRecipient=rec;waitingForPowerUpChoice=false;isPowerUpPanelActive=true;
    document.getElementById("powerUpOverlay").style.display="block";
    document.getElementById("teleportPanel").style.display="none";
    document.getElementById("operatorPanel").style.display="block";
}
function hidePowerUpPanel() {
    isPowerUpPanelActive=false;
    document.getElementById("powerUpOverlay").style.display="none";
}

function handleTeleportChoice(choice) {
    let dir=1,dn="TOP";
    if(choice==="L"){dir=0;dn="LEFT";}else if(choice==="R"){dir=2;dn="RIGHT";}
    pendingTeleportDirection=dir;isTeleportPending=true;currentDiceImg=null;
    systemMessage="🌀 Teleport "+dn+" locked! Click 'ROLL' for your operation.";
    preRolledPowerUp="";powerUpRecipient=null;hidePowerUpPanel();repaintAll();
}
function handleOperatorChoice(choice) {
    if(!["+","-","*","/"].includes(choice))choice="+";
    currentOperation=choice;currentDiceImg=null;needsToRollOp=false;
    waitingForPowerUpChoice=false;preRolledPowerUp="";powerUpRecipient=null;
    systemMessage="Operation changed to "+currentOperation+". Use arrow keys to move.";
    hidePowerUpPanel();
    if(currentTurn===1)p1.startTimer();else p2.startTimer();
    repaintAll();
}
function applyOperation(player,tv) {
    if(currentOperation==="+")player.currentTotal+=tv;
    else if(currentOperation==="-")player.currentTotal-=tv;
    else if(currentOperation==="*")player.currentTotal*=tv;
    else if(currentOperation==="/"){if(tv!==0)player.currentTotal=Math.trunc(player.currentTotal/tv);}
}
function checkWinCondition() {
    gameOver=true;p1.stopTimer();p2.stopTimer();
    let d1=Math.abs(targetGoal-p1.currentTotal),d2=Math.abs(targetGoal-p2.currentTotal);
    let w="IT'S A TIE!";
    if(d1<d2)w="PLAYER 1 WINS!";else if(d2<d1)w="PLAYER 2 WINS!";
    gameOverWinner=w;gameOverTargetGoal=targetGoal;
    gameOverP1Score=p1.currentTotal;gameOverP2Score=p2.currentTotal;
    repaintAll();
}
