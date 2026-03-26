(function() {
    // DOM elements
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    const runsSpan = document.getElementById('runs');
    const wicketsSpan = document.getElementById('wickets');
    const oversSpan = document.getElementById('overs');
    const targetSpan = document.getElementById('target');
    const rrrSpan = document.getElementById('rrr');
    const feedbackDiv = document.getElementById('feedbackMsg');
    const startBtn = document.getElementById('startBtn');
    const swingBtn = document.getElementById('swingButton');
    const teamSelect = document.getElementById('teamSelect');
    const oversSelect = document.getElementById('oversSelect');

    // Game dimensions
    const BOWLER_X = 150;
    const STUMPS_X = 850;
    const BALL_Y = 250;

    // Timing sweet spot (where perfect hit occurs)
    const PERFECT_START = STUMPS_X - 60;
    const PERFECT_END = STUMPS_X - 30;
    const GOOD_START = STUMPS_X - 90;
    const GOOD_END = STUMPS_X - 10;
    // Outside good zone is early/late

    // Scoring arc on the left side
    const ARC_X = 80;
    const ARC_TOP_Y = 120;
    const ARC_BOTTOM_Y = 380;
    // Arc zones (from top to bottom): runs, color, y-range
    const arcZones = [
        { runs: 1, color: "#4caf50", yStart: 120, yEnd: 170, label: "1" },
        { runs: 2, color: "#8bc34a", yStart: 170, yEnd: 220, label: "2" },
        { runs: 4, color: "#ff9800", yStart: 220, yEnd: 280, label: "4" },
        { runs: 6, color: "#f44336", yStart: 280, yEnd: 320, label: "6" }, // sweet spot
        { runs: 4, color: "#ff9800", yStart: 320, yEnd: 360, label: "4" },
        { runs: 2, color: "#8bc34a", yStart: 360, yEnd: 400, label: "2" },
        { runs: 1, color: "#4caf50", yStart: 400, yEnd: 450, label: "1" }
    ];

    // Game states
    const STATE_IDLE = 'idle';
    const STATE_BOWLING = 'bowling';
    const STATE_HIT = 'hit';
    let gameState = STATE_IDLE;

    let gameActive = false;
    let currentAnimationId = null;
    let ballX = BOWLER_X;
    let ballY = BALL_Y;
    let ballSpeed = 6.2;
    let hasSwungThisBall = false;
    let currentDeliveryResultProcessed = false;

    // Hit flight variables
    let hitStartX, hitStartY;
    let hitTargetX, hitTargetY;
    let hitProgress = 0;
    let hitDuration = 30;
    let hitFrame = 0;
    let pendingRuns = 0;

    // Batsman animation
    let batsmanStanceOffset = 0;
    let swingAnimating = false;
    let swingFrame = 0;

    // Particles and trail
    let particles = [];
    let trailPositions = [];

    // Match stats
    let score = 0;
    let wickets = 0;
    let totalOvers = 5;
    let totalBallsBowled = 0;
    let target = 0;
    let battingTeam = "India";

    // Helper functions
    function formatOvers(ballsDelivered) {
        let oversDone = Math.floor(ballsDelivered / 6);
        let balls = ballsDelivered % 6;
        return `${oversDone}.${balls}`;
    }

    function updateScoreboardUI() {
        runsSpan.innerText = score;
        wicketsSpan.innerText = wickets;
        oversSpan.innerText = formatOvers(totalBallsBowled);
        targetSpan.innerText = target;
        let remainingBalls = (totalOvers * 6) - totalBallsBowled;
        let runsNeeded = target - score;
        let requiredRate = (remainingBalls > 0) ? (runsNeeded / (remainingBalls/6)).toFixed(2) : (runsNeeded <= 0 ? "0.00" : "∞");
        if(runsNeeded <= 0) requiredRate = "0.00";
        rrrSpan.innerText = requiredRate;
    }

    function checkGameOver() {
        let isGameFinished = false;
        let endMsg = "";
        if(score >= target){
            endMsg = `🏆 VICTORY! ${battingTeam} chased down ${target} runs! 🏆`;
            isGameFinished = true;
        } else if(wickets >= 10){
            endMsg = `😭 ALL OUT! ${battingTeam} lost by ${target - score} runs. 😭`;
            isGameFinished = true;
        } else if(totalBallsBowled >= totalOvers * 6){
            if(score >= target) endMsg = `🏆 WIN! Target reached in last ball!`;
            else endMsg = `📉 DEFEAT! Failed to chase ${target} runs. Overs finished. 📉`;
            isGameFinished = true;
        }
        if(isGameFinished && gameActive){
            gameActive = false;
            gameState = STATE_IDLE;
            feedbackDiv.innerText = endMsg + " Press START for new game.";
            swingBtn.disabled = true;
            return true;
        }
        return false;
    }

    function addParticles(x, y, count, color) {
        for(let i=0; i<count; i++) {
            particles.push({
                x: x,
                y: y,
                vx: (Math.random() - 0.5) * 6,
                vy: (Math.random() - 0.5) * 6 - 2,
                life: 0.8,
                color: color || `hsl(${Math.random() * 60 + 30}, 80%, 60%)`
            });
        }
    }

    function endDelivery(addedRuns = 0, isWicket = false) {
        if(currentDeliveryResultProcessed) return;
        currentDeliveryResultProcessed = true;
        if(isWicket){
            wickets++;
            feedbackDiv.innerText = "❌ OUT! ❌  Wicket falls!";
            addParticles(ballX, ballY, 15, "#ff6666");
        } else {
            score += addedRuns;
            feedbackDiv.innerText = `🏏 ${addedRuns} runs! Great hit! 🏏`;
            addParticles(ballX, ballY, 20, "#ffcc66");
        }
        totalBallsBowled++;
        updateScoreboardUI();
        setTimeout(() => {
            if(gameActive && !checkGameOver()){
                resetForNextBall();
                startBallDelivery();
            }
        }, 1000);
    }

    function resetForNextBall() {
        gameState = STATE_IDLE;
        hasSwungThisBall = false;
        currentDeliveryResultProcessed = false;
        ballX = BOWLER_X;
        ballY = BALL_Y;
        trailPositions = [];
        hitFrame = 0;
        hitProgress = 0;
        swingAnimating = false;
        drawCanvas();
    }

    // Determine landing zone based on timing (ball x position)
    function getTargetYFromTiming(ballPos) {
        // Perfect timing
        if (ballPos >= PERFECT_START && ballPos <= PERFECT_END) {
            // Sweet spot: 6-run zone (middle)
            let zone = arcZones.find(z => z.runs === 6);
            let y = zone.yStart + (zone.yEnd - zone.yStart) / 2;
            return y + (Math.random() - 0.5) * 20;
        }
        // Good timing
        else if (ballPos >= GOOD_START && ballPos <= GOOD_END) {
            // 4-run zones (two of them)
            let fourZones = arcZones.filter(z => z.runs === 4);
            let zone = fourZones[Math.floor(Math.random() * fourZones.length)];
            let y = zone.yStart + (zone.yEnd - zone.yStart) / 2;
            return y + (Math.random() - 0.5) * 30;
        }
        // Early/Late timing
        else {
            // 1 or 2 runs
            let lowZones = arcZones.filter(z => z.runs <= 2);
            let zone = lowZones[Math.floor(Math.random() * lowZones.length)];
            let y = zone.yStart + (zone.yEnd - zone.yStart) / 2;
            return y + (Math.random() - 0.5) * 40;
        }
    }

    // Called when player swings
    function playerSwing() {
        if(!gameActive || gameState !== STATE_BOWLING || hasSwungThisBall || currentDeliveryResultProcessed) return;
        hasSwungThisBall = true;
        
        // Start swing animation
        swingAnimating = true;
        swingFrame = 0;
        
        const currentBallPos = ballX;
        
        // Check if ball is within valid hit range (near batsman)
        if (currentBallPos < STUMPS_X - 120) {
            // Too early, miss, wicket
            feedbackDiv.innerText = "💀 TOO EARLY! BALL HITS STUMPS! 💀";
            endDelivery(0, true);
            return;
        }
        
        // Determine target Y on arc based on timing
        let targetY = getTargetYFromTiming(currentBallPos);
        // Clamp to arc bounds
        targetY = Math.min(ARC_BOTTOM_Y + 20, Math.max(ARC_TOP_Y - 20, targetY));
        
        hitStartX = ballX;
        hitStartY = ballY;
        hitTargetX = ARC_X + 20;
        hitTargetY = targetY;
        hitFrame = 0;
        hitProgress = 0;
        
        // Determine which zone we're aiming for to get runs
        let runsAwarded = 0;
        for (let zone of arcZones) {
            if (targetY >= zone.yStart && targetY <= zone.yEnd) {
                runsAwarded = zone.runs;
                break;
            }
        }
        pendingRuns = runsAwarded;
        
        gameState = STATE_HIT;
        if(currentAnimationId) cancelAnimationFrame(currentAnimationId);
        currentAnimationId = null;
        
        function animateHit() {
            if(gameState !== STATE_HIT) return;
            hitFrame++;
            hitProgress = hitFrame / hitDuration;
            if(hitProgress >= 1) {
                endDelivery(pendingRuns, false);
                return;
            }
            let t = hitProgress;
            // Curved path (arc)
            let x = hitStartX + (hitTargetX - hitStartX) * t;
            let y = hitStartY + (hitTargetY - hitStartY) * t - 40 * t * (1 - t);
            ballX = x;
            ballY = y;
            drawCanvas();
            requestAnimationFrame(animateHit);
        }
        animateHit();
    }

    // Bowling animation
    function animateBall() {
        if(gameState !== STATE_BOWLING) return;
        ballX += ballSpeed;
        ballY = BALL_Y + Math.sin(Date.now() * 0.015) * 1.5;
        
        trailPositions.unshift({x: ballX, y: ballY});
        if(trailPositions.length > 12) trailPositions.pop();
        
        if(ballX >= STUMPS_X){
            if(!hasSwungThisBall && !currentDeliveryResultProcessed && gameActive){
                hasSwungThisBall = true;
                feedbackDiv.innerText = "🪓 NO SWING! BOWLED! OUT! 🪓";
                endDelivery(0, true);
            } else if(!currentDeliveryResultProcessed && hasSwungThisBall){
                if(!currentDeliveryResultProcessed) endDelivery(0, false);
            }
            return;
        }
        if(currentDeliveryResultProcessed) return;
        drawCanvas();
        requestAnimationFrame(animateBall);
    }

    function startBallDelivery() {
        if(!gameActive) return;
        if(checkGameOver()) return;
        gameState = STATE_BOWLING;
        hasSwungThisBall = false;
        currentDeliveryResultProcessed = false;
        ballX = BOWLER_X;
        ballY = BALL_Y;
        trailPositions = [];
        drawCanvas();
        animateBall();
    }

    // ---------- DRAWING ----------
    function drawPitch() {
        // Dark grass gradient
        const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
        grad.addColorStop(0, "#1a3a2f");
        grad.addColorStop(1, "#0f2a20");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Pitch rectangle with neon outline
        ctx.fillStyle = "#2c4a3a";
        ctx.shadowBlur = 0;
        ctx.fillRect(60, 60, canvas.width-120, canvas.height-120);
        ctx.fillStyle = "#3e6a52";
        ctx.fillRect(65, 65, canvas.width-130, canvas.height-130);
        
        // Crease lines with neon
        ctx.beginPath();
        ctx.strokeStyle = "#00d4ff";
        ctx.lineWidth = 2;
        ctx.setLineDash([10, 15]);
        ctx.moveTo(STUMPS_X-25, 80);
        ctx.lineTo(STUMPS_X-25, canvas.height-80);
        ctx.moveTo(STUMPS_X+15, 80);
        ctx.lineTo(STUMPS_X+15, canvas.height-80);
        ctx.stroke();
        ctx.moveTo(BOWLER_X-20, 80);
        ctx.lineTo(BOWLER_X-20, canvas.height-80);
        ctx.moveTo(BOWLER_X+20, 80);
        ctx.lineTo(BOWLER_X+20, canvas.height-80);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    function drawScoringArc() {
        // Draw arc background
        ctx.globalAlpha = 0.6;
        for (let zone of arcZones) {
            ctx.fillStyle = zone.color;
            ctx.fillRect(ARC_X - 15, zone.yStart, 35, zone.yEnd - zone.yStart);
        }
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.strokeRect(ARC_X - 15, ARC_TOP_Y, 35, ARC_BOTTOM_Y - ARC_TOP_Y);
        
        // Labels
        ctx.font = "bold 16px 'Segoe UI'";
        ctx.fillStyle = "#fff";
        ctx.shadowBlur = 2;
        for (let zone of arcZones) {
            let midY = (zone.yStart + zone.yEnd) / 2;
            ctx.fillText(zone.label, ARC_X - 5, midY + 5);
        }
        ctx.fillStyle = "#00d4ff";
        ctx.font = "bold 14px monospace";
        ctx.fillText("SCORING ZONES", ARC_X - 25, ARC_TOP_Y - 10);
    }

    function drawStumps() {
        ctx.fillStyle = "#b87c4f";
        for(let i=0;i<3;i++){
            ctx.fillRect(STUMPS_X-18 + i*12, BALL_Y-12, 8, 42);
        }
        ctx.fillStyle = "#d49c6c";
        ctx.fillRect(STUMPS_X-22, BALL_Y-18, 8, 12);
        ctx.fillRect(STUMPS_X-6, BALL_Y-18, 8, 12);
        ctx.fillRect(STUMPS_X+10, BALL_Y-18, 8, 12);
    }

    function drawBatsman() {
        let idleShift = Math.sin(Date.now() * 0.005) * 2;
        // Helmet
        ctx.fillStyle = "#2c3e50";
        ctx.beginPath();
        ctx.ellipse(STUMPS_X-40 + idleShift*0.5, BALL_Y-18 + idleShift*0.2, 16, 19, 0, 0, Math.PI*2);
        ctx.fill();
        ctx.fillStyle = "#f0c0a0";
        ctx.beginPath();
        ctx.ellipse(STUMPS_X-40 + idleShift*0.5, BALL_Y-17 + idleShift*0.2, 13, 15, 0, 0, Math.PI*2);
        ctx.fill();
        ctx.fillStyle = "#000";
        ctx.beginPath();
        ctx.arc(STUMPS_X-46 + idleShift*0.5, BALL_Y-22 + idleShift*0.2, 2, 0, Math.PI*2);
        ctx.arc(STUMPS_X-34 + idleShift*0.5, BALL_Y-22 + idleShift*0.2, 2, 0, Math.PI*2);
        ctx.fill();
        ctx.fillStyle = "#2a5f8a";
        ctx.fillRect(STUMPS_X-48 + idleShift*0.5, BALL_Y-8 + idleShift*0.2, 30, 32);
        
        ctx.save();
        ctx.translate(STUMPS_X-30 + idleShift*0.5, BALL_Y + idleShift*0.2);
        if(swingAnimating) {
            let angle = Math.sin(swingFrame * 0.3) * 0.9;
            ctx.rotate(angle);
            swingFrame++;
            if(swingFrame > 15) swingAnimating = false;
        } else {
            let idleRot = Math.sin(Date.now() * 0.003) * 0.05;
            ctx.rotate(idleRot);
        }
        ctx.fillStyle = "#c78c46";
        ctx.fillRect(-18, -6, 40, 12);
        ctx.fillStyle = "#b56a2e";
        ctx.fillRect(-22, 0, 12, 8);
        ctx.restore();
        
        ctx.fillStyle = "#2c3e50";
        ctx.fillRect(STUMPS_X-44 + idleShift*0.5, BALL_Y+22 + idleShift*0.2, 10, 18);
        ctx.fillRect(STUMPS_X-30 + idleShift*0.5, BALL_Y+22 + idleShift*0.2, 10, 18);
    }

    function drawBowler() {
        ctx.fillStyle = "#4a6a3a";
        ctx.fillRect(BOWLER_X-18, BALL_Y-16, 36, 44);
        ctx.fillStyle = "#e0ac77";
        ctx.beginPath();
        ctx.arc(BOWLER_X, BALL_Y-28, 14, 0, Math.PI*2);
        ctx.fill();
        ctx.fillStyle = "#000";
        ctx.beginPath();
        ctx.arc(BOWLER_X-6, BALL_Y-32, 2, 0, Math.PI*2);
        ctx.arc(BOWLER_X+6, BALL_Y-32, 2, 0, Math.PI*2);
        ctx.fill();
        ctx.fillStyle = "#3e2723";
        ctx.fillRect(BOWLER_X-16, BALL_Y-46, 32, 12);
        let armAngle = Math.sin(Date.now() * 0.01) * 0.3;
        ctx.beginPath();
        ctx.moveTo(BOWLER_X+12, BALL_Y-18);
        ctx.lineTo(BOWLER_X+36 + armAngle*8, BALL_Y-28 - armAngle*4);
        ctx.lineTo(BOWLER_X+28 + armAngle*4, BALL_Y-12 + armAngle*2);
        ctx.fillStyle = "#5a7a42";
        ctx.fill();
    }

    function drawBallWithTrail(x, y) {
        for(let i=0; i<trailPositions.length; i++) {
            let t = trailPositions[i];
            ctx.globalAlpha = 0.3 - i*0.025;
            ctx.beginPath();
            ctx.arc(t.x, t.y, 5 - i*0.3, 0, Math.PI*2);
            ctx.fillStyle = `rgba(220, 80, 40, ${0.5 - i*0.04})`;
            ctx.fill();
        }
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.arc(x, y, 7, 0, Math.PI*2);
        ctx.fillStyle = "#d84c2c";
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(x, y, 7, 3, 0, 0, Math.PI*2);
        ctx.strokeStyle = "#f9f3c1";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x-4, y-1);
        ctx.lineTo(x+4, y+1);
        ctx.moveTo(x-4, y+1);
        ctx.lineTo(x+4, y-1);
        ctx.stroke();
        ctx.shadowBlur = 0;
    }

    function drawParticles() {
        for(let i=0; i<particles.length; i++) {
            let p = particles[i];
            ctx.beginPath();
            ctx.arc(p.x, p.y, 3, 0, Math.PI*2);
            ctx.fillStyle = p.color;
            ctx.fill();
            p.x += p.vx;
            p.y += p.vy;
            p.life -= 0.02;
            p.vy += 0.2;
        }
        particles = particles.filter(p => p.life > 0);
    }

    function drawTimingMeter() {
        // Draw the timing zone indicator near batsman
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = "#00d4ff";
        ctx.fillRect(PERFECT_START, BALL_Y-25, PERFECT_END-PERFECT_START, 12);
        ctx.fillStyle = "#88ffaa";
        ctx.fillRect(GOOD_START, BALL_Y-25, GOOD_END-GOOD_START, 12);
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#fff";
        ctx.font = "10px monospace";
        ctx.fillText("Early", GOOD_START-35, BALL_Y-14);
        ctx.fillText("Good", PERFECT_START-25, BALL_Y-14);
        ctx.fillText("Perfect", PERFECT_START+15, BALL_Y-14);
        ctx.fillText("Late", PERFECT_END+15, BALL_Y-14);
    }

    function drawCanvas() {
        drawPitch();
        drawScoringArc();
        drawBowler();
        drawStumps();
        drawBatsman();
        drawBallWithTrail(ballX, ballY);
        drawParticles();
        drawTimingMeter();

        ctx.font = "bold 22px 'Segoe UI'";
        ctx.fillStyle = "#00d4ff";
        ctx.shadowBlur = 3;
        ctx.fillText(`${battingTeam}  ${score}/${wickets}`, 40, 55);
        ctx.font = "16px monospace";
        ctx.fillStyle = "#88ffaa";
        ctx.fillText(`Target: ${target}  |  Overs: ${formatOvers(totalBallsBowled)}/${totalOvers}`, 40, 92);
        
        if(gameState === STATE_BOWLING && gameActive){
            ctx.font = "bold 26px monospace";
            ctx.fillStyle = "#ffd966";
            ctx.shadowBlur = 4;
            ctx.fillText("⚡ SWING NOW ⚡", canvas.width-200, 70);
        }
        if(!gameActive){
            ctx.font = "bold 20px monospace";
            ctx.fillStyle = "#ffffffcc";
            ctx.fillText("PRESS START", canvas.width/2-70, canvas.height-40);
        }
    }

    // ---------- MATCH INIT ----------
    function startMatch(){
        if(currentAnimationId) cancelAnimationFrame(currentAnimationId);
        currentAnimationId = null;
        battingTeam = teamSelect.value;
        totalOvers = parseInt(oversSelect.value);
        let baseMin = totalOvers * 8;
        let baseMax = totalOvers * 14 + 8;
        target = Math.floor(Math.random() * (baseMax - baseMin + 1) + baseMin);
        if(target < 15 && totalOvers===2) target = 18 + Math.floor(Math.random()*12);
        score = 0;
        wickets = 0;
        totalBallsBowled = 0;
        gameActive = true;
        gameState = STATE_IDLE;
        hasSwungThisBall = false;
        currentDeliveryResultProcessed = false;
        ballX = BOWLER_X;
        ballY = BALL_Y;
        particles = [];
        trailPositions = [];
        updateScoreboardUI();
        feedbackDiv.innerText = "🏏 MATCH STARTED! WAIT FOR BALL... 🏏";
        swingBtn.disabled = false;
        drawCanvas();
        setTimeout(() => {
            if(gameActive) startBallDelivery();
        }, 600);
    }

    // ---------- EVENT HANDLERS ----------
    function handleSwingInteraction(e){
        if(!gameActive){
            feedbackDiv.innerText = "⚠️ Press START MATCH first! ⚠️";
            return;
        }
        if(gameState !== STATE_BOWLING){
            feedbackDiv.innerText = "⏳ Wait for the ball to be bowled! ⏳";
            return;
        }
        if(hasSwungThisBall){
            feedbackDiv.innerText = "Already swung for this ball!";
            return;
        }
        playerSwing();
    }
    swingBtn.addEventListener('click', handleSwingInteraction);
    canvas.addEventListener('click', handleSwingInteraction);
    canvas.addEventListener('touchstart', (e) => { e.preventDefault(); handleSwingInteraction(e); });
    swingBtn.addEventListener('touchstart', (e) => { e.preventDefault(); handleSwingInteraction(e); });
    startBtn.addEventListener('click', () => startMatch());

    drawCanvas();
    swingBtn.disabled = true;
    feedbackDiv.innerText = "⚡ Select team & overs, then START MATCH ⚡";
})();
