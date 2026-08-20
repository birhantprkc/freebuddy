(function () {
  const BOARD_COLS = 9;
  const BOARD_ROWS = 10;
  const COL_LETTERS = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];

  // Piece Definitions
  const PIECE_NAMES = {
    1: "帥", 2: "仕", 3: "相", 4: "傌", 5: "俥", 6: "炮", 7: "兵",
    "-1": "將", "-2": "士", "-3": "象", "-4": "馬", "-5": "車", "-6": "砲", "-7": "卒"
  };

  // State
  let board = createInitialBoard();
  let turn = 1; // 1: Player (Red), 2: Agent (Black)
  let status = "playing";
  let lastMove = null;
  let selectedCoord = null;
  let legalTargets = [];
  let hoverCoord = null;
  let initialized = false;

  // DOM Elements
  const canvas = document.getElementById("xiangqi-canvas");
  const ctx = canvas.getContext("2d");
  const turnBadge = document.getElementById("turn-badge");
  const speechText = document.getElementById("speech-text");
  const statusText = document.getElementById("status-text");
  const restartBtn = document.getElementById("restart-btn");
  const resignBtn = document.getElementById("resign-btn");
  const retryAgentBtn = document.getElementById("retry-agent-btn");

  function createInitialBoard() {
    const b = Array.from({ length: BOARD_ROWS }, () => Array(BOARD_COLS).fill(0));
    // Red Side (bottom, y = 0..3)
    b[0][0] = 5; b[0][1] = 4; b[0][2] = 3; b[0][3] = 2; b[0][4] = 1;
    b[0][5] = 2; b[0][6] = 3; b[0][7] = 4; b[0][8] = 5;
    b[2][1] = 6; b[2][7] = 6;
    b[3][0] = 7; b[3][2] = 7; b[3][4] = 7; b[3][6] = 7; b[3][8] = 7;

    // Black Side (top, y = 6..9)
    b[9][0] = -5; b[9][1] = -4; b[9][2] = -3; b[9][3] = -2; b[9][4] = -1;
    b[9][5] = -2; b[9][6] = -3; b[9][7] = -4; b[9][8] = -5;
    b[7][1] = -6; b[7][7] = -6;
    b[6][0] = -7; b[6][2] = -7; b[6][4] = -7; b[6][6] = -7; b[6][8] = -7;
    return b;
  }

  let isMuted = localStorage.getItem("freebuddy_game_muted") === "true";
  let audioCtx = null;
  let gameOverSoundPlayed = false;

  const muteBtn = document.getElementById("mute-btn");
  function updateMuteButtonUI() {
    if (!muteBtn) return;
    if (isMuted) {
      muteBtn.textContent = "🔇";
      muteBtn.classList.add("muted");
      muteBtn.title = "音效已静音（点击开启）";
    } else {
      muteBtn.textContent = "🔊";
      muteBtn.classList.remove("muted");
      muteBtn.title = "音效已开启（点击静音）";
    }
  }
  if (muteBtn) {
    updateMuteButtonUI();
    muteBtn.addEventListener("click", () => {
      isMuted = !isMuted;
      localStorage.setItem("freebuddy_game_muted", String(isMuted));
      updateMuteButtonUI();
    });
  }

  function withAudio(callback) {
    if (isMuted) return;
    try {
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioCtx.state === "suspended") {
        audioCtx.resume().then(() => {
          if (audioCtx && audioCtx.state === "running") {
            callback(audioCtx);
          }
        }).catch(() => {});
      } else if (audioCtx.state === "running") {
        callback(audioCtx);
      }
    } catch {}
  }

  // Global user interaction unlock
  const unlockAudio = () => {
    try {
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioCtx && audioCtx.state === "suspended") {
        audioCtx.resume();
      }
    } catch {}
  };
  window.addEventListener("pointerdown", unlockAudio, { passive: true });
  window.addEventListener("keydown", unlockAudio, { passive: true });

  // 1. Move Sound: Solid Wood Strike (实木落子)
  function playPieceSound(isCapture = false) {
    withAudio((ctx) => {
      const now = ctx.currentTime;
      if (isCapture) {
        // Heavy impact capture
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = "sawtooth";
        osc1.frequency.setValueAtTime(260, now);
        osc1.frequency.exponentialRampToValueAtTime(45, now + 0.15);
        gain1.gain.setValueAtTime(0.5, now);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        osc1.connect(gain1);
        gain1.connect(ctx.destination);
        osc1.start(now);
        osc1.stop(now + 0.15);

        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = "triangle";
        osc2.frequency.setValueAtTime(140, now);
        osc2.frequency.exponentialRampToValueAtTime(30, now + 0.13);
        gain2.gain.setValueAtTime(0.38, now);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.start(now);
        osc2.stop(now + 0.13);
      } else {
        // Solid wood placement
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = "triangle";
        osc1.frequency.setValueAtTime(340, now);
        osc1.frequency.exponentialRampToValueAtTime(80, now + 0.09);
        gain1.gain.setValueAtTime(0.42, now);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
        osc1.connect(gain1);
        gain1.connect(ctx.destination);
        osc1.start(now);
        osc1.stop(now + 0.09);

        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = "sine";
        osc2.frequency.setValueAtTime(120, now);
        osc2.frequency.exponentialRampToValueAtTime(45, now + 0.1);
        gain2.gain.setValueAtTime(0.28, now);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.start(now);
        osc2.stop(now + 0.1);
      }
    });
  }

  // 2. Select Piece Sound: Soft wood tap (选子轻触)
  function playSelectSound() {
    withAudio((ctx) => {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(560, now);
      osc.frequency.exponentialRampToValueAtTime(320, now + 0.04);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.04);
    });
  }

  // 3. Check Sound: Ancient East Asian Zither / Chime Strike (将军！金石之声)
  function playCheckSound() {
    withAudio((ctx) => {
      const freqs = [440.0, 554.37, 659.25, 880.0]; // A4, C#5, E5, A5
      const now = ctx.currentTime;
      freqs.forEach((freq, i) => {
        const start = now + i * 0.04;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.28, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.45);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.45);
      });
    });
  }

  // 4. Victory Sound (旗开得胜)
  function playVictorySound() {
    withAudio((ctx) => {
      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
      const now = ctx.currentTime;
      notes.forEach((freq, idx) => {
        const start = now + idx * 0.1;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.3, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.38);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.38);
      });
    });
  }

  // 5. Defeat Sound (惜败)
  function playDefeatSound() {
    withAudio((ctx) => {
      const notes = [392.0, 349.23, 311.13, 261.63]; // G4, F4, Eb4, C4
      const now = ctx.currentTime;
      notes.forEach((freq, idx) => {
        const start = now + idx * 0.14;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.24, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.3);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.3);
      });
    });
  }

  function coordToString(x, y) {
    const col = COL_LETTERS[x] || `${x}`;
    return `${col}${y}`;
  }

  function moveToString(fromX, fromY, toX, toY) {
    return `${coordToString(fromX, fromY)}${coordToString(toX, toY)}`;
  }

  let cellWidth = 0;
  let cellHeight = 0;
  let paddingX = 0;
  let paddingY = 0;
  let pieceRadius = 0;

  function resizeCanvas() {
    const parent = canvas.parentElement || document.body;
    const parentRect = parent.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    const availWidth = Math.max(0, parentRect.width - 12);
    const availHeight = Math.max(0, parentRect.height - 12);

    // 9:10 aspect ratio
    let width = availWidth;
    let height = (width * 10) / 9;

    if (height > availHeight) {
      height = availHeight;
      width = (height * 9) / 10;
    }

    width = Math.floor(width);
    height = Math.floor(height);
    if (width <= 0 || height <= 0) return;

    paddingX = Math.max(22, Math.round(width * 0.08));
    paddingY = Math.max(22, Math.round(height * 0.075));
    cellWidth = (width - paddingX * 2) / (BOARD_COLS - 1);
    cellHeight = (height - paddingY * 2) / (BOARD_ROWS - 1);
    pieceRadius = Math.min(cellWidth, cellHeight) * 0.46;

    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    drawBoard();
  }

  function getMouseGridCoord(e) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    const mouseX = (e.clientX - rect.left) * (canvas.width / (window.devicePixelRatio || 1) / rect.width);
    const mouseY = (e.clientY - rect.top) * (canvas.height / (window.devicePixelRatio || 1) / rect.height);

    // Find closest intersection
    const x = Math.round((mouseX - paddingX) / cellWidth);
    const y = Math.round((mouseY - paddingY) / cellHeight);

    // Invert display Y so Red (y=0) is visually at the bottom
    const gridY = BOARD_ROWS - 1 - y;

    if (x >= 0 && x < BOARD_COLS && gridY >= 0 && gridY < BOARD_ROWS) {
      return { x, y: gridY };
    }
    return null;
  }

  function getPixelCoord(gridX, gridY) {
    const displayY = BOARD_ROWS - 1 - gridY;
    const px = paddingX + gridX * cellWidth;
    const py = paddingY + displayY * cellHeight;
    return { px, py };
  }

  // Draw corner markers (折角)
  function drawCornerMarker(gx, gy) {
    const { px, py } = getPixelCoord(gx, gy);
    const len = cellWidth * 0.16;
    const dist = cellWidth * 0.08;

    ctx.strokeStyle = "rgba(92, 58, 33, 0.75)";
    ctx.lineWidth = 1.5;

    const drawCorner = (dirX, dirY) => {
      ctx.beginPath();
      ctx.moveTo(px + dirX * dist, py + dirY * (dist + len));
      ctx.lineTo(px + dirX * dist, py + dirY * dist);
      ctx.lineTo(px + dirX * (dist + len), py + dirY * dist);
      ctx.stroke();
    };

    if (gx > 0) {
      drawCorner(-1, -1);
      drawCorner(-1, 1);
    }
    if (gx < BOARD_COLS - 1) {
      drawCorner(1, -1);
      drawCorner(1, 1);
    }
  }

  // Draw 3D Wooden Chinese Chess Piece
  function drawPiece(gx, gy, piece, isSelected = false) {
    const { px, py } = getPixelCoord(gx, gy);
    const isRed = piece > 0;
    const name = PIECE_NAMES[piece] || "";
    const radius = pieceRadius;

    ctx.save();

    // 1. Drop Shadow
    ctx.shadowColor = isSelected ? "rgba(245, 158, 11, 0.7)" : "rgba(0, 0, 0, 0.4)";
    ctx.shadowBlur = isSelected ? 12 : 6;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 3;

    // 2. Outer Wood Circle with Radial Gradient
    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    const woodGrad = ctx.createRadialGradient(
      px - radius * 0.3,
      py - radius * 0.3,
      radius * 0.1,
      px,
      py,
      radius
    );
    woodGrad.addColorStop(0, "#fef3c7");
    woodGrad.addColorStop(0.7, "#fde68a");
    woodGrad.addColorStop(1, "#d97706");
    ctx.fillStyle = woodGrad;
    ctx.fill();

    // 3. Outer Rim Border
    ctx.strokeStyle = isSelected ? "#f59e0b" : "#92400e";
    ctx.lineWidth = isSelected ? 3 : 2;
    ctx.stroke();

    // 4. Inset Ring Line
    ctx.beginPath();
    ctx.arc(px, py, radius * 0.82, 0, Math.PI * 2);
    ctx.strokeStyle = isRed ? "rgba(220, 38, 38, 0.4)" : "rgba(30, 41, 59, 0.4)";
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // 5. Piece Calligraphic Character
    ctx.font = `bold ${Math.round(radius * 1.05)}px "Kaiti", "STKaiti", "KaiTi_GB2312", "SimSun", "Microsoft YaHei", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = isRed ? "#b91c1c" : "#0f172a";
    ctx.shadowColor = isRed ? "rgba(254, 202, 202, 0.8)" : "rgba(226, 232, 240, 0.6)";
    ctx.shadowBlur = 1;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 1;

    ctx.fillText(name, px, py + 1);

    ctx.restore();
  }

  // Render complete Xiangqi Canvas
  function drawBoard() {
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;
    if (width <= 0 || height <= 0) return;

    ctx.clearRect(0, 0, width, height);

    // 1. Board Background Texture
    const bgGrad = ctx.createLinearGradient(0, 0, width, height);
    bgGrad.addColorStop(0, "#f5dfb8");
    bgGrad.addColorStop(1, "#e6c896");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    // Outer double wooden frame
    ctx.strokeStyle = "#5c3a21";
    ctx.lineWidth = 2.5;
    ctx.strokeRect(paddingX - 6, paddingY - 6, (BOARD_COLS - 1) * cellWidth + 12, (BOARD_ROWS - 1) * cellHeight + 12);
    ctx.lineWidth = 1;
    ctx.strokeRect(paddingX - 10, paddingY - 10, (BOARD_COLS - 1) * cellWidth + 20, (BOARD_ROWS - 1) * cellHeight + 20);

    // 2. Grid lines
    ctx.strokeStyle = "#78350f";
    ctx.lineWidth = 1.2;

    // Horizontal Lines (all 10 rows connected)
    for (let r = 0; r < BOARD_ROWS; r++) {
      const y = paddingY + r * cellHeight;
      ctx.beginPath();
      ctx.moveTo(paddingX, y);
      ctx.lineTo(paddingX + (BOARD_COLS - 1) * cellWidth, y);
      ctx.stroke();
    }

    // Vertical Lines (outer columns 0 & 8 connected through river; middle columns broken at river)
    for (let c = 0; c < BOARD_COLS; c++) {
      const x = paddingX + c * cellWidth;

      if (c === 0 || c === BOARD_COLS - 1) {
        // Outer borders go all the way
        ctx.beginPath();
        ctx.moveTo(x, paddingY);
        ctx.lineTo(x, paddingY + (BOARD_ROWS - 1) * cellHeight);
        ctx.stroke();
      } else {
        // Top half (Black side: row 0 to 4)
        ctx.beginPath();
        ctx.moveTo(x, paddingY);
        ctx.lineTo(x, paddingY + 4 * cellHeight);
        ctx.stroke();

        // Bottom half (Red side: row 5 to 9)
        ctx.beginPath();
        ctx.moveTo(x, paddingY + 5 * cellHeight);
        ctx.lineTo(x, paddingY + 9 * cellHeight);
        ctx.stroke();
      }
    }

    // 3. Palace Diagonals (九宫格斜线)
    // Black Palace (top)
    ctx.beginPath();
    ctx.moveTo(paddingX + 3 * cellWidth, paddingY + 0 * cellHeight);
    ctx.lineTo(paddingX + 5 * cellWidth, paddingY + 2 * cellHeight);
    ctx.moveTo(paddingX + 5 * cellWidth, paddingY + 0 * cellHeight);
    ctx.lineTo(paddingX + 3 * cellWidth, paddingY + 2 * cellHeight);
    // Red Palace (bottom)
    ctx.moveTo(paddingX + 3 * cellWidth, paddingY + 7 * cellHeight);
    ctx.lineTo(paddingX + 5 * cellWidth, paddingY + 9 * cellHeight);
    ctx.moveTo(paddingX + 5 * cellWidth, paddingY + 7 * cellHeight);
    ctx.lineTo(paddingX + 3 * cellWidth, paddingY + 9 * cellHeight);
    ctx.stroke();

    // 4. River Calligraphy (楚河 漢界)
    const riverY = paddingY + 4.5 * cellHeight;
    ctx.font = `bold ${Math.round(cellHeight * 0.42)}px "Kaiti", "STKaiti", "KaiTi_GB2312", "Microsoft YaHei", serif`;
    ctx.fillStyle = "rgba(120, 53, 15, 0.75)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.fillText("楚  河", paddingX + 2 * cellWidth, riverY);
    ctx.fillText("漢  界", paddingX + 6 * cellWidth, riverY);

    // 4.5 Coordinate Labels (a-i along top/bottom, 0-9 along left/right)
    ctx.fillStyle = "rgba(120, 53, 15, 0.85)";
    ctx.font = `600 ${Math.max(10, Math.round(cellWidth * 0.28))}px "Segoe UI", "PingFang SC", -apple-system, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // Column Letters (a - i)
    for (let c = 0; c < BOARD_COLS; c++) {
      const x = paddingX + c * cellWidth;
      const colChar = COL_LETTERS[c];
      // Bottom (below Red baseline)
      ctx.fillText(colChar, x, height - paddingY * 0.42);
      // Top (above Black baseline)
      ctx.fillText(colChar, x, paddingY * 0.42);
    }

    // Row Numbers (0 - 9, UCCI algebraic notation: 0 at Red bottom, 9 at Black top)
    for (let r = 0; r < BOARD_ROWS; r++) {
      const y = paddingY + r * cellHeight;
      const rowNum = `${BOARD_ROWS - 1 - r}`;
      // Left
      ctx.fillText(rowNum, paddingX * 0.45, y);
      // Right
      ctx.fillText(rowNum, width - paddingX * 0.45, y);
    }

    // 5. Star / Cross Markers (兵/炮位十字花)
    const starMarkers = [
      // Red cannon & pawns
      [1, 2], [7, 2], [0, 3], [2, 3], [4, 3], [6, 3], [8, 3],
      // Black cannon & pawns
      [1, 7], [7, 7], [0, 6], [2, 6], [4, 6], [6, 6], [8, 6]
    ];
    for (const [sx, sy] of starMarkers) {
      drawCornerMarker(sx, sy);
    }

    // 6. Last Move Highlights
    if (lastMove && lastMove.fromX !== undefined && lastMove.toX !== undefined) {
      const fromPos = getPixelCoord(lastMove.fromX, lastMove.fromY);
      const toPos = getPixelCoord(lastMove.toX, lastMove.toY);
      const r = pieceRadius * 1.08;

      ctx.save();
      ctx.strokeStyle = "rgba(59, 130, 246, 0.85)";
      ctx.lineWidth = 2.5;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(fromPos.px - r, fromPos.py - r, r * 2, r * 2);
      ctx.setLineDash([]);
      ctx.strokeStyle = "rgba(239, 68, 68, 0.9)";
      ctx.strokeRect(toPos.px - r, toPos.py - r, r * 2, r * 2);
      ctx.restore();
    }

    // 7. Render Pieces
    for (let y = 0; y < BOARD_ROWS; y++) {
      for (let x = 0; x < BOARD_COLS; x++) {
        const piece = board[y][x];
        if (piece !== 0) {
          const isSelected = selectedCoord && selectedCoord.x === x && selectedCoord.y === y;
          drawPiece(x, y, piece, isSelected);
        }
      }
    }

    // 8. Render Legal Move Target Indicators
    if (selectedCoord && legalTargets.length > 0) {
      for (const target of legalTargets) {
        const { px, py } = getPixelCoord(target.toX, target.toY);
        const targetPiece = board[target.toY][target.toX];

        ctx.save();
        if (targetPiece !== 0) {
          // Capture Ring
          ctx.strokeStyle = "rgba(239, 68, 68, 0.85)";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(px, py, pieceRadius * 1.15, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          // Empty Move Dot
          ctx.fillStyle = "rgba(16, 185, 129, 0.85)";
          ctx.beginPath();
          ctx.arc(px, py, pieceRadius * 0.32, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    }
  }

  // Client-side quick legal move calculator for instant response
  function getClientLegalMoves(fromX, fromY) {
    const piece = board[fromY][fromX];
    if (piece <= 0) return []; // Red pieces only for player
    const absPiece = Math.abs(piece);
    const moves = [];

    const addIfValid = (tx, ty) => {
      if (tx < 0 || tx >= BOARD_COLS || ty < 0 || ty >= BOARD_ROWS) return;
      if (board[ty][tx] > 0) return; // Cannot capture own red pieces
      moves.push({ toX: tx, toY: ty });
    };

    switch (absPiece) {
      case 1: { // 帥 King
        const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
        for (const [dx, dy] of dirs) {
          const nx = fromX + dx;
          const ny = fromY + dy;
          if (nx >= 3 && nx <= 5 && ny >= 0 && ny <= 2) {
            addIfValid(nx, ny);
          }
        }
        // Flying general
        let cy = fromY + 1;
        while (cy < BOARD_ROWS) {
          const p = board[cy][fromX];
          if (p !== 0) {
            if (p === -1) moves.push({ toX: fromX, toY: cy });
            break;
          }
          cy++;
        }
        break;
      }
      case 2: { // 仕 Advisor
        const dirs = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
        for (const [dx, dy] of dirs) {
          const nx = fromX + dx;
          const ny = fromY + dy;
          if (nx >= 3 && nx <= 5 && ny >= 0 && ny <= 2) {
            addIfValid(nx, ny);
          }
        }
        break;
      }
      case 3: { // 相 Bishop
        const dirs = [[2, 2], [2, -2], [-2, 2], [-2, -2]];
        for (const [dx, dy] of dirs) {
          const nx = fromX + dx;
          const ny = fromY + dy;
          const ex = fromX + dx / 2;
          const ey = fromY + dy / 2;
          if (nx >= 0 && nx < BOARD_COLS && ny >= 0 && ny <= 4) {
            if (board[ey][ex] === 0) addIfValid(nx, ny);
          }
        }
        break;
      }
      case 4: { // 傌 Knight
        const km = [
          { dx: 1, dy: 2, lx: 0, ly: 1 }, { dx: -1, dy: 2, lx: 0, ly: 1 },
          { dx: 1, dy: -2, lx: 0, ly: -1 }, { dx: -1, dy: -2, lx: 0, ly: -1 },
          { dx: 2, dy: 1, lx: 1, ly: 0 }, { dx: 2, dy: -1, lx: 1, ly: 0 },
          { dx: -2, dy: 1, lx: -1, ly: 0 }, { dx: -2, dy: -1, lx: -1, ly: 0 }
        ];
        for (const m of km) {
          const nx = fromX + m.dx;
          const ny = fromY + m.dy;
          if (nx >= 0 && nx < BOARD_COLS && ny >= 0 && ny < BOARD_ROWS) {
            if (board[fromY + m.ly][fromX + m.lx] === 0) addIfValid(nx, ny);
          }
        }
        break;
      }
      case 5: { // 俥 Rook
        const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
        for (const [dx, dy] of dirs) {
          let nx = fromX + dx, ny = fromY + dy;
          while (nx >= 0 && nx < BOARD_COLS && ny >= 0 && ny < BOARD_ROWS) {
            const t = board[ny][nx];
            if (t === 0) {
              moves.push({ toX: nx, toY: ny });
            } else {
              if (t < 0) moves.push({ toX: nx, toY: ny });
              break;
            }
            nx += dx; ny += dy;
          }
        }
        break;
      }
      case 6: { // 炮 Cannon
        const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
        for (const [dx, dy] of dirs) {
          let nx = fromX + dx, ny = fromY + dy;
          let jumped = false;
          while (nx >= 0 && nx < BOARD_COLS && ny >= 0 && ny < BOARD_ROWS) {
            const t = board[ny][nx];
            if (!jumped) {
              if (t === 0) moves.push({ toX: nx, toY: ny });
              else jumped = true;
            } else {
              if (t !== 0) {
                if (t < 0) moves.push({ toX: nx, toY: ny });
                break;
              }
            }
            nx += dx; ny += dy;
          }
        }
        break;
      }
      case 7: { // 兵 Pawn
        addIfValid(fromX, fromY + 1);
        if (fromY >= 5) {
          addIfValid(fromX - 1, fromY);
          addIfValid(fromX + 1, fromY);
        }
        break;
      }
    }

    return moves;
  }

  function handleCanvasClick(e) {
    if (status !== "playing") {
      statusText.textContent = "本局已结束，请点击下方【重新开局】。";
      return;
    }

    if (turn !== 1) {
      statusText.textContent = "当前轮到 AI Agent (黑方) 走子，请稍候...";
      return;
    }

    const coord = getMouseGridCoord(e);
    if (!coord) return;

    const { x, y } = coord;
    const clickedPiece = board[y][x];

    // Case 1: Clicking own Red piece -> Select it
    if (clickedPiece > 0) {
      selectedCoord = { x, y };
      legalTargets = getClientLegalMoves(x, y);
      statusText.textContent = `已选择【${PIECE_NAMES[clickedPiece]}】，点击绿色标记点移动。`;
      playSelectSound();
      drawBoard();
      return;
    }

    // Case 2: Clicking destination with a piece selected
    if (selectedCoord) {
      const isLegal = legalTargets.some((t) => t.toX === x && t.toY === y);
      if (isLegal) {
        const fromX = selectedCoord.x;
        const fromY = selectedCoord.y;
        const actionId = moveToString(fromX, fromY, x, y);
        const movingPiece = board[fromY][fromX];
        const isCapture = board[y][x] < 0;

        // Apply local optimistic update
        board[y][x] = movingPiece;
        board[fromY][fromX] = 0;
        lastMove = { fromX, fromY, toX: x, toY: y, actionId, player: 1 };
        turn = 2;
        selectedCoord = null;
        legalTargets = [];

        playPieceSound(isCapture);
        updateUI();
        drawBoard();

        // Notify Host
        window.parent.postMessage({
          type: "PLAYER_MOVE",
          payload: { actionId, fromX, fromY, toX: x, toY: y }
        }, "*");
      } else {
        selectedCoord = null;
        legalTargets = [];
        drawBoard();
      }
    }
  }

  function updateUI() {
    if (status === "player_won") {
      if (!gameOverSoundPlayed) {
        gameOverSoundPlayed = true;
        playVictorySound();
      }
      turnBadge.className = "turn-indicator win";
      turnBadge.textContent = "🏆 旗开得胜！你赢了";
      statusText.textContent = "🎉 恭喜你绝杀获胜！棋局已完整保留供复盘截图。";
      restartBtn.className = "btn primary";
      restartBtn.textContent = "再来一局";
      resignBtn.style.display = "none";
      if (retryAgentBtn) retryAgentBtn.style.display = "none";
    } else if (status === "agent_won") {
      if (!gameOverSoundPlayed) {
        gameOverSoundPlayed = true;
        playDefeatSound();
      }
      turnBadge.className = "turn-indicator lose";
      turnBadge.textContent = "🤖 Agent 绝杀获胜";
      statusText.textContent = "本局对战结束，棋局已完整保留供复盘截图。";
      restartBtn.className = "btn primary";
      restartBtn.textContent = "再来一局";
      resignBtn.style.display = "none";
      if (retryAgentBtn) retryAgentBtn.style.display = "none";
    } else if (status === "draw") {
      turnBadge.className = "turn-indicator draw";
      turnBadge.textContent = "🤝 双方握手言和 (平局)";
      statusText.textContent = "双方握手言和。点击【再来一局】开启新对决。";
      restartBtn.className = "btn primary";
      restartBtn.textContent = "再来一局";
      resignBtn.style.display = "none";
      if (retryAgentBtn) retryAgentBtn.style.display = "none";
    } else {
      gameOverSoundPlayed = false;
      restartBtn.className = "btn";
      restartBtn.textContent = "重新开局";
      resignBtn.style.display = "inline-block";
      if (turn === 1) {
        turnBadge.className = "turn-indicator active-player";
        turnBadge.textContent = "轮到你行动 (红方)";
        statusText.textContent = "点击己方棋子，再点击目标位置移动";
        if (retryAgentBtn) retryAgentBtn.style.display = "none";
      } else {
        turnBadge.className = "turn-indicator active-agent";
        turnBadge.textContent = "Agent 正在思考中... (黑方)";
        statusText.textContent = "AI Agent 正在思考走子方案...";
      }
    }
  }

  function syncState(snapshot) {
    if (!snapshot) return;
    const prevMove = lastMove;
    board = snapshot.board || board;
    turn = snapshot.turn ?? turn;
    status = snapshot.status || status;
    lastMove = snapshot.lastMove || null;

    if (snapshot.chatHistory && snapshot.chatHistory.length > 0) {
      const latestAgentChat = [...snapshot.chatHistory].reverse().find((c) => c.sender === "agent");
      if (latestAgentChat) {
        speechText.textContent = latestAgentChat.message;
      }
    }

    if (initialized && lastMove && (!prevMove || prevMove.actionId !== lastMove.actionId)) {
      playPieceSound(Boolean(lastMove.capturedPiece));
    }
    initialized = true;

    selectedCoord = null;
    legalTargets = [];
    updateUI();
    drawBoard();
  }

  // Host Message Listener
  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || typeof data !== "object") return;

    if (data.type === "FREEBUDDY_GAME_SYNC" || data.type === "GAME_STATE_UPDATE") {
      syncState(data.payload);
    } else if (data.type === "AGENT_CHAT") {
      speechText.textContent = data.payload?.message || "";
    } else if (data.type === "AGENT_STALLED") {
      const isStalled = Boolean(data.payload?.stalled);
      if (isStalled && turn === 2 && status === "playing") {
        if (retryAgentBtn) retryAgentBtn.style.display = "inline-block";
        statusText.textContent = "AI 回复结束但未走子，请点击【重试】";
      } else {
        if (retryAgentBtn) retryAgentBtn.style.display = "none";
      }
    }
  });

  // Action Buttons
  restartBtn.addEventListener("click", () => {
    window.parent.postMessage({ type: "GAME_RESET" }, "*");
  });

  resignBtn.addEventListener("click", () => {
    if (confirm("确定要认输吗？")) {
      window.parent.postMessage({ type: "GAME_RESIGN" }, "*");
    }
  });

  if (retryAgentBtn) {
    retryAgentBtn.addEventListener("click", () => {
      window.parent.postMessage({ type: "REMIND_AGENT" }, "*");
      retryAgentBtn.style.display = "none";
      statusText.textContent = "已向 AI 重新发送走子请求...";
    });
  }

  canvas.addEventListener("click", handleCanvasClick);

  window.addEventListener("resize", resizeCanvas);
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => {
      resizeCanvas();
    });
    ro.observe(canvas);
  }

  // Share Card Generation
  const shareBtn = document.getElementById("share-btn");
  const shareModal = document.getElementById("share-modal");
  const closeShareBtn = document.getElementById("close-share-btn");
  const shareImagePreview = document.getElementById("share-image-preview");
  const copyShareBtn = document.getElementById("copy-share-btn");
  const downloadShareBtn = document.getElementById("download-share-btn");
  const shareToast = document.getElementById("share-toast");

  function showToast(msg) {
    if (!shareToast) return;
    shareToast.textContent = msg;
    shareToast.style.display = "block";
    setTimeout(() => {
      shareToast.style.display = "none";
    }, 2000);
  }

  function generateShareImageCanvas() {
    const cardCanvas = document.createElement("canvas");
    const cardWidth = 720;
    const cardHeight = 920;
    cardCanvas.width = cardWidth;
    cardCanvas.height = cardHeight;
    const sCtx = cardCanvas.getContext("2d");

    // 1. Background Gradient
    const bgGrad = sCtx.createLinearGradient(0, 0, 0, cardHeight);
    bgGrad.addColorStop(0, "#0f172a");
    bgGrad.addColorStop(0.5, "#1e293b");
    bgGrad.addColorStop(1, "#090d16");
    sCtx.fillStyle = bgGrad;
    sCtx.fillRect(0, 0, cardWidth, cardHeight);

    // Decorative aura
    sCtx.save();
    const aura = sCtx.createRadialGradient(cardWidth / 2, 240, 10, cardWidth / 2, 240, 380);
    aura.addColorStop(0, "rgba(220, 38, 38, 0.15)");
    aura.addColorStop(1, "rgba(0, 0, 0, 0)");
    sCtx.fillStyle = aura;
    sCtx.fillRect(0, 0, cardWidth, cardHeight);
    sCtx.restore();

    // 2. Card Header
    sCtx.font = "bold 20px -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif";
    sCtx.fillStyle = "#f87171";
    sCtx.fillText("FreeBuddy 对战大厅", 40, 52);

    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    sCtx.font = "14px -apple-system, sans-serif";
    sCtx.fillStyle = "#94a3b8";
    sCtx.textAlign = "right";
    sCtx.fillText(dateStr, cardWidth - 40, 52);
    sCtx.textAlign = "left";

    // 3. Match Title & Status Badge
    sCtx.font = "bold 28px -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif";
    sCtx.fillStyle = "#ffffff";
    sCtx.fillText("中国象棋 · 赛后复盘战报", 40, 98);

    // Outcome Badge
    let outcomeText = "对局进行中";
    let badgeColor = "#3b82f6";
    if (status === "player_won") {
      outcomeText = "🏆 玩家绝杀胜出";
      badgeColor = "#10b981";
    } else if (status === "agent_won") {
      outcomeText = "🤖 AI Agent 绝杀获胜";
      badgeColor = "#ef4444";
    } else if (status === "draw") {
      outcomeText = "🤝 双方握手言和 (平局)";
      badgeColor = "#94a3b8";
    }

    sCtx.font = "bold 15px -apple-system, sans-serif";
    const textWidth = sCtx.measureText(outcomeText).width;
    const badgeX = 40;
    const badgeY = 118;
    sCtx.fillStyle = "rgba(255, 255, 255, 0.08)";
    sCtx.strokeStyle = badgeColor;
    sCtx.lineWidth = 1.5;
    sCtx.beginPath();
    if (typeof sCtx.roundRect === "function") {
      sCtx.roundRect(badgeX, badgeY, textWidth + 24, 30, 15);
    } else {
      sCtx.rect(badgeX, badgeY, textWidth + 24, 30);
    }
    sCtx.fill();
    sCtx.stroke();

    sCtx.fillStyle = badgeColor;
    sCtx.fillText(outcomeText, badgeX + 12, badgeY + 20);

    // Players Info
    sCtx.font = "15px -apple-system, sans-serif";
    sCtx.fillStyle = "#e2e8f0";
    sCtx.textAlign = "right";
    sCtx.fillText("🔴 你 (红先)  VS  ⚫ AI Agent (黑后)", cardWidth - 40, 138);
    sCtx.textAlign = "left";

    // 4. Draw Chessboard (9:10 ratio)
    const boardW = 540;
    const boardH = 600;
    const boardX = (cardWidth - boardW) / 2;
    const boardY = 175;

    sCtx.save();
    sCtx.shadowColor = "rgba(0, 0, 0, 0.6)";
    sCtx.shadowBlur = 24;
    sCtx.shadowOffsetY = 12;
    sCtx.drawImage(canvas, boardX, boardY, boardW, boardH);
    sCtx.restore();

    // 5. Footer Watermark
    sCtx.font = "13px -apple-system, sans-serif";
    sCtx.fillStyle = "#64748b";
    sCtx.textAlign = "center";
    sCtx.fillText("由 FreeBuddy AI 智能体对战引擎驱动 · Powered by FreeBuddy", cardWidth / 2, cardHeight - 36);

    return cardCanvas;
  }

  function openShareModal() {
    const shareCanvas = generateShareImageCanvas();
    const dataUrl = shareCanvas.toDataURL("image/png");
    if (shareImagePreview) {
      shareImagePreview.src = dataUrl;
    }
    if (shareModal) {
      shareModal.style.display = "flex";
    }
  }

  function closeShareModal() {
    if (shareModal) {
      shareModal.style.display = "none";
    }
  }

  if (shareBtn) {
    shareBtn.addEventListener("click", openShareModal);
  }

  if (closeShareBtn) {
    closeShareBtn.addEventListener("click", closeShareModal);
  }

  if (shareModal) {
    shareModal.addEventListener("click", (e) => {
      if (e.target === shareModal) closeShareModal();
    });
  }

  if (copyShareBtn) {
    copyShareBtn.addEventListener("click", async () => {
      try {
        const shareCanvas = generateShareImageCanvas();
        shareCanvas.toBlob(async (blob) => {
          if (!blob) return;
          try {
            await navigator.clipboard.write([
              new ClipboardItem({ "image/png": blob })
            ]);
            showToast("✓ 图片已复制到剪贴板！");
          } catch {
            showToast("复制失败，请使用保存图片");
          }
        }, "image/png");
      } catch {
        showToast("复制失败，请使用保存图片");
      }
    });
  }

  if (downloadShareBtn) {
    downloadShareBtn.addEventListener("click", () => {
      const shareCanvas = generateShareImageCanvas();
      const link = document.createElement("a");
      const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      link.download = `FreeBuddy_象棋战报_${timestamp}.png`;
      link.href = shareCanvas.toDataURL("image/png");
      link.click();
      showToast("✓ 战报图片已下载！");
    });
  }

  // Initialize
  resizeCanvas();
  updateUI();

  // Notify host that canvas is ready
  window.parent.postMessage({ type: "GAME_CANVAS_READY" }, "*");
})();
