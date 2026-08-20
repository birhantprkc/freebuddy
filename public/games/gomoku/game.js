(function () {
  const BOARD_SIZE = 15;
  const COLS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O"];
  const STAR_POINTS = [
    [3, 3], [11, 3], [7, 7], [3, 11], [11, 11]
  ];

  // State
  let board = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(0));
  let turn = 1; // 1: Player (Black), 2: Agent (White)
  let status = "playing";
  let lastMove = null;
  let hoverCoord = null;
  let audioCtx = null;

  // DOM Elements
  const canvas = document.getElementById("gomoku-canvas");
  const ctx = canvas.getContext("2d");
  const turnBadge = document.getElementById("turn-badge");
  const speechText = document.getElementById("speech-text");
  const statusText = document.getElementById("status-text");
  const restartBtn = document.getElementById("restart-btn");
  const resignBtn = document.getElementById("resign-btn");
  const retryAgentBtn = document.getElementById("retry-agent-btn");

  // Web Audio Synth for crisp stone placement click
  function playStoneSound() {
    try {
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioCtx.state === "suspended") {
        audioCtx.resume();
      }
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(440, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(120, audioCtx.currentTime + 0.08);

      gain.gain.setValueAtTime(0.35, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.08);

      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.08);
    } catch (e) {
      // Audio not permitted or supported
    }
  }

  function coordToString(x, y) {
    const col = COLS[x] || `${x}`;
    const row = BOARD_SIZE - y;
    return `${col}${row}`;
  }

  let currentGridSize = 0;
  let currentPadding = 0;
  let currentCellSize = 0;

  function resizeCanvas() {
    const parent = canvas.parentElement || document.body;
    const parentRect = parent.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const availWidth = Math.max(0, parentRect.width - 12);
    const availHeight = Math.max(0, parentRect.height - 12);
    const size = Math.floor(Math.min(availWidth, availHeight));
    if (size <= 0) return;

    currentGridSize = size;
    currentPadding = Math.max(22, Math.round(size * 0.08));
    currentCellSize = (size - currentPadding * 2) / (BOARD_SIZE - 1);

    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    drawBoard();
  }

  function getMouseGridCoord(e) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || currentGridSize <= 0) return null;

    const mouseX = (e.clientX - rect.left) * (currentGridSize / rect.width);
    const mouseY = (e.clientY - rect.top) * (currentGridSize / rect.height);

    const x = Math.round((mouseX - currentPadding) / currentCellSize);
    const y = Math.round((mouseY - currentPadding) / currentCellSize);

    if (x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE) {
      return { x, y };
    }
    return null;
  }

  function drawStone(x, y, radius, player) {
    ctx.save();
    // Drop shadow
    ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 3;

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);

    if (player === 1) {
      // Black stone (3D gradient)
      const grad = ctx.createRadialGradient(
        x - radius * 0.3,
        y - radius * 0.3,
        radius * 0.1,
        x,
        y,
        radius
      );
      grad.addColorStop(0, "#666666");
      grad.addColorStop(0.4, "#222222");
      grad.addColorStop(1, "#0a0a0a");
      ctx.fillStyle = grad;
    } else {
      // White stone (3D gradient)
      const grad = ctx.createRadialGradient(
        x - radius * 0.3,
        y - radius * 0.3,
        radius * 0.1,
        x,
        y,
        radius
      );
      grad.addColorStop(0, "#ffffff");
      grad.addColorStop(0.7, "#eeeeee");
      grad.addColorStop(1, "#cccccc");
      ctx.fillStyle = grad;
    }
    ctx.fill();
    ctx.restore();
  }

  function drawBoard() {
    if (currentGridSize <= 0) {
      resizeCanvas();
      return;
    }

    const size = currentGridSize;
    const padding = currentPadding;
    const cellSize = currentCellSize;
    const stoneRadius = cellSize * 0.43;

    ctx.clearRect(0, 0, size, size);

    // Board background texture
    ctx.fillStyle = "#deb887";
    ctx.fillRect(0, 0, size, size);

    // Grid lines
    ctx.strokeStyle = "#5c3a21";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let i = 0; i < BOARD_SIZE; i++) {
      // Horizontal
      ctx.moveTo(padding, padding + i * cellSize);
      ctx.lineTo(size - padding, padding + i * cellSize);
      // Vertical
      ctx.moveTo(padding + i * cellSize, padding);
      ctx.lineTo(padding + i * cellSize, size - padding);
    }
    ctx.stroke();

    // Coordinates labels
    ctx.fillStyle = "#6b4423";
    ctx.font = `600 ${Math.max(10, cellSize * 0.34)}px -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    for (let i = 0; i < BOARD_SIZE; i++) {
      // Letters along bottom
      ctx.fillText(COLS[i], padding + i * cellSize, size - padding * 0.42);
      // Numbers along left
      ctx.fillText(`${BOARD_SIZE - i}`, padding * 0.45, padding + i * cellSize);
    }

    // Star points
    ctx.fillStyle = "#5c3a21";
    for (const [sx, sy] of STAR_POINTS) {
      ctx.beginPath();
      ctx.arc(padding + sx * cellSize, padding + sy * cellSize, cellSize * 0.1, 0, Math.PI * 2);
      ctx.fill();
    }

    // Stones
    for (let y = 0; y < BOARD_SIZE; y++) {
      for (let x = 0; x < BOARD_SIZE; x++) {
        const val = board[y][x];
        if (val !== 0) {
          drawStone(padding + x * cellSize, padding + y * cellSize, stoneRadius, val);
        }
      }
    }

    // Last Move Indicator
    if (lastMove) {
      const lx = padding + lastMove.x * cellSize;
      const ly = padding + lastMove.y * cellSize;
      ctx.strokeStyle = lastMove.player === 1 ? "#ef4444" : "#3b82f6";
      ctx.lineWidth = 2.5;
      ctx.strokeRect(lx - stoneRadius * 0.4, ly - stoneRadius * 0.4, stoneRadius * 0.8, stoneRadius * 0.8);
    }

    // Hover stone preview & crosshair snap circle
    if (hoverCoord && status === "playing" && turn === 1 && board[hoverCoord.y][hoverCoord.x] === 0) {
      const hx = padding + hoverCoord.x * cellSize;
      const hy = padding + hoverCoord.y * cellSize;

      // Small target ring at the exact intersection point
      ctx.strokeStyle = "rgba(59, 130, 246, 0.8)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(hx, hy, stoneRadius * 0.35, 0, Math.PI * 2);
      ctx.stroke();

      ctx.save();
      ctx.globalAlpha = 0.55;
      drawStone(hx, hy, stoneRadius, 1);
      ctx.restore();
    }
  }

  function handleCanvasClick(e) {
    if (status !== "playing") {
      statusText.textContent = "本局已结束，请点击下方【重新开局】发起新一轮对战。";
      return;
    }

    if (turn !== 1) {
      statusText.textContent = "当前轮到 AI Agent (白子) 行动，请稍候或点击下方【催促 Agent】。";
      return;
    }

    const coord = getMouseGridCoord(e);
    if (!coord) return;

    const { x, y } = coord;
    if (board[y][x] !== 0) {
      statusText.textContent = `坐标 ${coordToString(x, y)} 已有棋子，请在空白交叉点落子。`;
      return;
    }

    const actionId = coordToString(x, y);

    // Local optimistic update
    board[y][x] = 1;
    lastMove = { x, y, player: 1, actionId };
    turn = 2;
    hoverCoord = null;
    playStoneSound();
    updateUI();
    drawBoard();

    // Post message to FreeBuddy host
    window.parent.postMessage({
      type: "PLAYER_MOVE",
      payload: { actionId, x, y }
    }, "*");
  }

  function handleMouseMove(e) {
    if (status !== "playing") {
      if (hoverCoord) {
        hoverCoord = null;
        drawBoard();
      }
      return;
    }

    const coord = getMouseGridCoord(e);
    if (coord && board[coord.y][coord.x] === 0) {
      if (!hoverCoord || hoverCoord.x !== coord.x || hoverCoord.y !== coord.y) {
        hoverCoord = coord;
        drawBoard();
      }
    } else if (hoverCoord) {
      hoverCoord = null;
      drawBoard();
    }
  }

  function updateUI() {
    if (status === "player_won") {
      turnBadge.className = "turn-indicator win";
      turnBadge.textContent = "🏆 旗开得胜！你赢了";
      statusText.textContent = "🎉 恭喜你完成五连珠！棋盘已完整保留供复盘截图。";
      restartBtn.className = "btn primary";
      restartBtn.textContent = "再来一局";
      resignBtn.style.display = "none";
      if (retryAgentBtn) retryAgentBtn.style.display = "none";
    } else if (status === "agent_won") {
      turnBadge.className = "turn-indicator lose";
      turnBadge.textContent = "🤖 Agent 抢先连珠获胜";
      statusText.textContent = "本局对战结束，棋盘已完整保留供复盘截图。";
      restartBtn.className = "btn primary";
      restartBtn.textContent = "再来一局";
      resignBtn.style.display = "none";
      if (retryAgentBtn) retryAgentBtn.style.display = "none";
    } else if (status === "draw") {
      turnBadge.className = "turn-indicator draw";
      turnBadge.textContent = "🤝 双方握手言和 (平局)";
      statusText.textContent = "棋盘已满走满 225 步。点击【再来一局】开启新对决。";
      restartBtn.className = "btn primary";
      restartBtn.textContent = "再来一局";
      resignBtn.style.display = "none";
      if (retryAgentBtn) retryAgentBtn.style.display = "none";
    } else {
      restartBtn.className = "btn";
      restartBtn.textContent = "重新开局";
      resignBtn.style.display = "inline-block";
      if (turn === 1) {
        turnBadge.className = "turn-indicator active-player";
        turnBadge.textContent = "轮到你行动 (黑子)";
        statusText.textContent = "请在棋盘上点击落子";
        if (retryAgentBtn) retryAgentBtn.style.display = "none";
      } else {
        turnBadge.className = "turn-indicator active-agent";
        turnBadge.textContent = "Agent 正在思考中... (白子)";
        statusText.textContent = "AI Agent 正在思考并落子中...";
      }
    }
  }

  let initialized = false;

  function syncState(snapshot) {
    if (!snapshot) return;
    const prevMove = lastMove;
    board = snapshot.board || board;
    turn = snapshot.turn ?? turn;
    status = snapshot.status || status;
    lastMove = snapshot.lastMove || null;

    if (snapshot.chatHistory && snapshot.chatHistory.length > 0) {
      const latestAgentChat = [...snapshot.chatHistory].reverse().find(c => c.sender === "agent");
      if (latestAgentChat) {
        speechText.textContent = latestAgentChat.message;
      }
    }

    // Only play sound if this is a new move arriving after initialization
    if (initialized && lastMove && (!prevMove || prevMove.actionId !== lastMove.actionId)) {
      playStoneSound();
    }
    initialized = true;

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
        statusText.textContent = "AI 回复结束但未落子，请点击【重试】";
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
      statusText.textContent = "已向 AI 重新发送落子请求...";
    });
  }

  canvas.addEventListener("click", handleCanvasClick);
  canvas.addEventListener("mousemove", handleMouseMove);
  canvas.addEventListener("mouseleave", () => {
    hoverCoord = null;
    drawBoard();
  });

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
    const cardHeight = 880;
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
    const aura = sCtx.createRadialGradient(cardWidth / 2, 220, 10, cardWidth / 2, 220, 360);
    aura.addColorStop(0, "rgba(59, 130, 246, 0.15)");
    aura.addColorStop(1, "rgba(0, 0, 0, 0)");
    sCtx.fillStyle = aura;
    sCtx.fillRect(0, 0, cardWidth, cardHeight);
    sCtx.restore();

    // 2. Card Header
    sCtx.font = "bold 20px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif";
    sCtx.fillStyle = "#38bdf8";
    sCtx.fillText("FreeBuddy 对战大厅", 40, 52);

    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    sCtx.font = "14px -apple-system, sans-serif";
    sCtx.fillStyle = "#94a3b8";
    sCtx.textAlign = "right";
    sCtx.fillText(dateStr, cardWidth - 40, 52);
    sCtx.textAlign = "left";

    // 3. Match Title & Status Badge
    sCtx.font = "bold 28px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif";
    sCtx.fillStyle = "#ffffff";
    sCtx.fillText("五子棋 · 赛后复盘战报", 40, 98);

    // Outcome Badge
    let outcomeText = "对局进行中";
    let badgeColor = "#3b82f6";
    if (status === "player_won") {
      outcomeText = "🏆 玩家胜出 (五连珠)";
      badgeColor = "#10b981";
    } else if (status === "agent_won") {
      outcomeText = "🤖 AI Agent 获胜";
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
    sCtx.fillText("⚫ 你 (黑先)  VS  ⚪ AI Agent (白后)", cardWidth - 40, 138);
    sCtx.textAlign = "left";

    // 4. Draw Chessboard
    const boardSize = 580;
    const boardX = (cardWidth - boardSize) / 2;
    const boardY = 175;

    sCtx.save();
    sCtx.shadowColor = "rgba(0, 0, 0, 0.6)";
    sCtx.shadowBlur = 24;
    sCtx.shadowOffsetY = 12;
    sCtx.drawImage(canvas, boardX, boardY, boardSize, boardSize);
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
      link.download = `FreeBuddy_五子棋战报_${timestamp}.png`;
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
