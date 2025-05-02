// ==UserScript==
// @name         Chess.com Autobot
// @namespace    https://github.com/Emilprivate
// @version      1.0
// @description  Send your live Chess.com game to a local Stockfish backend and display the best move in real time.
// @match        https://www.chess.com/*
// @grant        none
// @require      https://cdn.jsdelivr.net/npm/axios/dist/axios.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/chess.js/0.10.3/chess.min.js
// ==/UserScript==
;(function(){
  window.addEventListener('error', event => {
    if (event.filename && event.filename.includes('safeFrame.html')) {
      event.stopImmediatePropagation();
      return true;
    }
  }, true);
  'use strict'
  const API='http://localhost:5000/bestmove'
  const game=new Chess()
  const style=document.createElement('style')
  style.textContent='.ai-highlight{transition:background .3s ease-in-out} #ai-terminal{white-space:pre-wrap;overflow-wrap:break-word;}'
  document.head.appendChild(style)


  const panel = document.createElement('div')
  panel.id = 'ai-panel'
  panel.style = 'position:fixed;bottom:10px;right:10px;background:rgba(0,0,0,0.8);color:#fff;padding:8px;border-radius:4px;z-index:2000;font-size:12px;max-width:240px;overflow-wrap:break-word;'
  panel.innerHTML = `
    <div id="ai-controls" style="display:flex;flex-direction:column;gap:6px;margin-bottom:6px">
      <div>AI for: <select id="ai-color-select"><option value="auto">Auto</option><option value="white">White</option><option value="black">Black</option></select></div>
      <div>Mode: <select id="ai-mode-select"><option value="bot">Bot</option><option value="human">Human</option></select></div>
      <div>Time Control: <select id="ai-time-select"><option value="bullet">1min Bullet</option><option value="blitz">3min Blitz</option><option value="rapid">10min Rapid</option></select></div>
      <div><label><input type="checkbox" id="ai-autoplay-checkbox"> Autoplay moves</label></div>
      <div id="ai-buttons" style="display:flex;gap:4px">
        <button id="ai-config-btn">Configure</button>
        <button id="ai-start-btn" disabled>Start</button>
        <button id="ai-restart-btn" disabled>Restart</button>
      </div>
    </div>
    <div id="ai-terminal" style="background:#111;color:#0f0;padding:6px;height:120px;overflow-y:auto;font-family:monospace;font-size:11px;border:1px solid #0f0"></div>
  `
  document.body.appendChild(panel)
  const pick = panel.querySelector('#ai-color-select')
  pick.value = localStorage.getItem('aiColor') || 'auto'

  pick.addEventListener('change', () => localStorage.setItem('aiColor', pick.value))
  const modePick = panel.querySelector('#ai-mode-select')
  modePick.value = localStorage.getItem('aiMode') || 'bot'
  modePick.addEventListener('change', () => {
    localStorage.setItem('aiMode', modePick.value)
    updateModeUI()
  })
  const timePick = panel.querySelector('#ai-time-select')
  timePick.value = localStorage.getItem('aiTime') || 'rapid'
  timePick.addEventListener('change', () => localStorage.setItem('aiTime', timePick.value))
  const configBtn = panel.querySelector('#ai-config-btn')
  const startBtn = panel.querySelector('#ai-start-btn')
  const restartBtn = panel.querySelector('#ai-restart-btn')
  const autoplayCheckbox = panel.querySelector('#ai-autoplay-checkbox')
  autoplayCheckbox.checked = localStorage.getItem('aiAutoplay') === 'true'
  autoplayCheckbox.addEventListener('change', () => localStorage.setItem('aiAutoplay', autoplayCheckbox.checked))

  function updateModeUI() {
    const mode = modePick.value
    if (mode === 'human') {
      configBtn.style.display = 'none'
      startBtn.disabled = false
    } else {
      configBtn.style.display = ''
      startBtn.disabled = true
    }
  }
  updateModeUI()
  const terminalEl = panel.querySelector('#ai-terminal')
  function termLog(msg) { const line = document.createElement('div'); line.textContent = msg; terminalEl.appendChild(line); terminalEl.scrollTop = terminalEl.scrollHeight; }
  let running = false
  let pollInterval = null
  let lastUciKey = ''
  configBtn.addEventListener('click', () => {
    configBtn.disabled = true;
    termLog('Configuring...');
    ensureTextNotation().then(() => {
      termLog('Configured');
      startBtn.disabled = false;
    });
  });
  startBtn.addEventListener('click', () => {
    running = true;
    startBtn.disabled = true;
    restartBtn.disabled = false;
    termLog('Starting...');
    onMovesUpdated();

    pollInterval = setInterval(onMovesUpdated, 2000);
  });
  restartBtn.addEventListener('click', () => {
    running = false;
    restartBtn.disabled = true;
    configBtn.disabled = false;
    lastUciKey = '';

    if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
    game.reset();
    clearHighlight();
    clearArrow();
    termLog('Restarted');
    updateModeUI();
  })

  pick.addEventListener('change', () => {

    restartBtn.click()
  })

  async function ensureTextNotation() {
    const xpathCog = '/html/body/div[5]/div/div[2]/div[3]/div/div[2]/div[1]/button[3]'
    const cog = document.evaluate(xpathCog, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue
    if(cog) { cog.click(); termLog('Opened settings'); }
    await new Promise(r => setTimeout(r, 200));
    const xpathSel = '/html/body/div[4]/div[2]/div[5]/div/div[2]/div/div[1]/div/div[6]/div/div[2]/div/select'
    const sel = document.evaluate(xpathSel, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue
    if(sel && sel.value!=='text') { sel.value='text'; sel.dispatchEvent(new Event('change',{bubbles:true})); termLog('Set piece notation to text'); }
    await new Promise(r => setTimeout(r, 200));
    const xpathSave = '/html/body/div[4]/div[2]/div[5]/div/div[2]/div/div[2]/button[2]';
    const saveBtn = document.evaluate(xpathSave, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    if(saveBtn) { saveBtn.click(); termLog('Saved settings'); }
    await new Promise(r => setTimeout(r, 200));
  }

  function clearHighlight(){
    document.querySelectorAll('.ai-highlight').forEach(el=>el.remove())
  }
  function drawSquareHighlight(sq) {
    const svg = document.querySelector('wc-chess-board svg.arrows');
    if (!svg) return;
    const size = 100 / 8;
    const [cx, cy] = coord(sq);
    const x = cx - size / 2;
    const y = cy - size / 2;
    const ns = 'http://www.w3.org/2000/svg';
    const rect = document.createElementNS(ns, 'rect');
    rect.setAttribute('x', x);
    rect.setAttribute('y', y);
    rect.setAttribute('width', size);
    rect.setAttribute('height', size);
    rect.setAttribute('stroke', 'yellow');
    rect.setAttribute('stroke-width', '1');
    rect.setAttribute('fill', 'none');
    svg.appendChild(rect);
  }
  function clearArrow() {
    const svg = document.querySelector('wc-chess-board svg.arrows');
    if (!svg) return;
    svg.querySelectorAll('line, rect').forEach(el => el.remove());
  }
  function coord(sq) {
    const file = sq.charCodeAt(0) - 97
    const rank = parseInt(sq[1]) - 1
    const size = 100 / 8
    const x = (file + 0.5) * size
    const y = ((7 - rank) + 0.5) * size
    return [x, y]
  }
  function drawArrow(from, to) {
    const svg = document.querySelector('wc-chess-board svg.arrows')
    if (!svg) return
    clearArrow()
    const [x1, y1] = coord(from)
    const [x2, y2] = coord(to)
    const ns = 'http://www.w3.org/2000/svg'

    let defs = svg.querySelector('defs')
    if (!defs) {
      defs = document.createElementNS(ns,'defs')
      const marker = document.createElementNS(ns,'marker')
      marker.setAttribute('id','ai-arrowhead')
      marker.setAttribute('markerWidth','3')
      marker.setAttribute('markerHeight','3')
      marker.setAttribute('refX','0')
      marker.setAttribute('refY','1.5')
      marker.setAttribute('orient','auto')
      const path = document.createElementNS(ns,'path')
      path.setAttribute('d','M0,0 L0,3 L3,1.5 Z')
      path.setAttribute('fill','rgba(255,255,0,0.8)')
      marker.appendChild(path)
      defs.appendChild(marker)
      svg.insertBefore(defs, svg.firstChild)
    }
    const line = document.createElementNS(ns, 'line')
    line.setAttribute('x1', x1)
    line.setAttribute('y1', y1)
    line.setAttribute('x2', x2)
    line.setAttribute('y2', y2)
    line.setAttribute('stroke', 'rgba(255,255,0,0.8)')
    line.setAttribute('stroke-width', '1')
    line.setAttribute('marker-end', 'url(#ai-arrowhead)')
    svg.appendChild(line)
    // highlight origin and destination squares
    drawSquareHighlight(from)
    drawSquareHighlight(to)
  }
  async function onMovesUpdated(){
    if (!running) return
    const choice = localStorage.getItem('aiColor') || 'auto'
    const mode = localStorage.getItem('aiMode') || 'bot'
    const timeControl = localStorage.getItem('aiTime') || 'rapid'
    let sanList = []
    if (mode === 'bot') {
      sanList = Array.from(
        document.querySelectorAll('.play-controller-moveList .node-highlight-content')
      ).map(el => el.textContent.trim()).filter(s => s && !/^\d/.test(s))
    } else {
      sanList = Array.from(
        document.querySelectorAll('#live-game-tab-scroll-container .node-highlight-content')
      ).map(el => el.textContent.trim()).filter(s => s && !/^\d/.test(s))
    }
    const sideToMove = sanList.length % 2 === 0 ? 'white' : 'black'
    if (choice !== 'auto' && sideToMove !== choice) {
      clearHighlight()
      termLog('Waiting...')
      return
    }
    clearHighlight()
    termLog('Waiting...')
    if(sanList.length===0)return
    game.reset()
    for(const san of sanList){
      if(/^\d+(\.\.\.)?$/.test(san))continue
      game.move(san,{sloppy:true})
    }
    const uciMoves=game.history({verbose:true}).map(m=>m.from+m.to)
    termLog('[AI] moves: ' + uciMoves.join(','))
    const uciKey = uciMoves.join(',')
    if (uciKey === lastUciKey) return
    lastUciKey = uciKey
    try{
      const boardEl = document.querySelector('wc-chess-board')
      const boardRect = boardEl?.getBoundingClientRect() || { left:0, top:0, width:0, height:0 }
      const tileSize = boardRect.width / 8
      const pickColor = localStorage.getItem('aiColor') || 'auto';
      const orientation = pickColor === 'auto' ? sideToMove : pickColor;
      termLog('[AI] POST ' + API + ' [' + timeControl + ']')
      const resp = await axios.post(API, {
        moves: uciMoves,
        timeControl,
        orientation,
        boardRect: {
          left: Math.round(boardRect.left),
          top: Math.round(boardRect.top),
          width: Math.round(boardRect.width),
          height: Math.round(boardRect.height)
        },
        tileSize: Math.round(tileSize)
      })
      termLog('[AI] got response: ' + resp.data.bestMove)
      const best=resp.data.bestMove
      const from=best.slice(0,2)
      const to=best.slice(2,4)
      termLog('Best move: ' + best)
      clearArrow()
      drawArrow(from, to)
      if (autoplayCheckbox.checked && mode === 'bot') {
        let fileFrom = from.charCodeAt(0) - 96;
        let rankFrom = parseInt(from[1], 10);
        let fileTo   = to.charCodeAt(0) - 96;
        let rankTo   = parseInt(to[1], 10);

        if (orientation === 'black') {
          fileFrom = 9 - fileFrom;
          rankFrom = 9 - rankFrom;
          fileTo   = 9 - fileTo;
          rankTo   = 9 - rankTo;
        }
        const fromEl = document.querySelector(`.square-${fileFrom}${rankFrom}`);
        const toEl   = document.querySelector(`.square-${fileTo}${rankTo}`);
        if (fromEl && toEl) {
          ['mousedown','mouseup','click'].forEach(type => {
            fromEl.dispatchEvent(new MouseEvent(type, { bubbles: true }));
          });
          setTimeout(() => {
            ['mousedown','mouseup','click'].forEach(type => {
              toEl.dispatchEvent(new MouseEvent(type, { bubbles: true }));
            });
            termLog('Autoplayed ' + best);
          }, 150);
        }
      }
    }catch(err){
      console.error('[AI] request error', err)
      termLog('Error')
    }
  }
  function attachObserver(){
    const mode = localStorage.getItem('aiMode') || 'bot'
    const selector = mode === 'human'
      ? document.querySelector('#live-game-tab-scroll-container')
      : document.querySelector('.play-controller-moveList')
    if(!selector) return setTimeout(attachObserver,1000)
    const obs = new MutationObserver(onMovesUpdated)
    obs.observe(selector, { childList:true, subtree:true })
    onMovesUpdated()
  }
  attachObserver()
})()