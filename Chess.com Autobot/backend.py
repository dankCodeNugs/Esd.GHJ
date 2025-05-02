#!/usr/bin/env python3
import sys
import time
import threading
from flask import Flask, request, jsonify
from flask_cors import CORS
import pyautogui
import subprocess

def calibrate():
    input('Calibration Step 1: Move your mouse cursor to the TOP-LEFT CORNER of top left square (top-left of board) and press Enter')
    x0, y0 = pyautogui.position()
    input('Calibration Step 2: Move your mouse cursor to the TOP-LEFT CORNER of the next one (one square to the right) and press Enter')
    x1, y1 = pyautogui.position()
    tile_size = x1 - x0
    print(f'Calibration complete: board origin at ({x0},{y0}), tile size = {tile_size}px')
    return x0, y0, tile_size

BOARD_LEFT, BOARD_TOP, TILE_SIZE = calibrate()

def sq_to_coords(sq):
    file = ord(sq[0]) - ord('a')
    rank = int(sq[1])
    y_idx = 8 - rank
    x = BOARD_LEFT + file * TILE_SIZE + TILE_SIZE/2
    y = BOARD_TOP + y_idx * TILE_SIZE + TILE_SIZE/2
    return x, y

app = Flask(__name__)
CORS(app)

def query_engine(moves, timeControl='rapid'):
    print(f"[bestmove] querying engine with moves: {moves}, timeControl: {timeControl}")
    engine = subprocess.Popen(
        ['stockfish'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
    )

    engine.stdin.write('uci\n')
    engine.stdin.flush()
    print('[stockfish] sent: uci')

    while True:
        line = engine.stdout.readline().strip()
        if line:
            print(f'[stockfish] recv: {line}')
        if line == 'uciok':
            break

    engine.stdin.write('isready\n')
    engine.stdin.flush()
    print('[stockfish] sent: isready')
    while True:
        line = engine.stdout.readline().strip()
        if line:
            print(f'[stockfish] recv: {line}')
        if line == 'readyok':
            break

    pos_cmd = 'position startpos moves ' + ' '.join(moves)
    engine.stdin.write(pos_cmd + '\n')
    engine.stdin.flush()
    print(f'[stockfish] sent: {pos_cmd}')

    depth_map = {'bullet': 5, 'blitz': 10, 'rapid': 15}
    depth = depth_map.get(timeControl, 15)
    go_cmd = f'go depth {depth}'
    engine.stdin.write(go_cmd + '\n')
    engine.stdin.flush()
    print(f'[stockfish] sent: {go_cmd}')

    best = None
    while True:
        line = engine.stdout.readline().strip()
        if line:
            print(f'[stockfish] recv: {line}')
        if line.startswith('bestmove'):
            parts = line.split()
            best = parts[1]
            print(f'[bestmove] engine bestmove: {best}')
            break
    engine.stdin.write('quit\n')
    engine.stdin.flush()
    engine.wait()
    return best

@app.route('/bestmove', methods=['POST'])
def bestmove_api():
    print('[bestmove] request payload:', request.json)
    data = request.json or {}
    moves = data.get('moves', [])
    timeControl = data.get('timeControl', 'rapid')
    orientation = data.get('orientation', 'white')

    side_to_move = 'white' if len(moves) % 2 == 0 else 'black'
    best = query_engine(moves, timeControl)

    def do_autoplay():
        if orientation != side_to_move:
            return

        def uci_to_coords(sq):
            file = ord(sq[0]) - ord('a')
            rank = int(sq[1])
            if orientation == 'black':
                file = 7 - file
                rank = 9 - rank
            y_idx = 8 - rank
            x = BOARD_LEFT + file * TILE_SIZE + TILE_SIZE/2
            y = BOARD_TOP + y_idx * TILE_SIZE + TILE_SIZE/2
            return x, y
        x1, y1 = uci_to_coords(best[:2])
        x2, y2 = uci_to_coords(best[2:4])

        speeds = {
            'bullet': {'move': 0.1, 'hold': 0.02, 'drag': 0.1},
            'blitz':  {'move': 0.3, 'hold': 0.05, 'drag': 0.3},
            'rapid':  {'move': 0.6, 'hold': 0.1,  'drag': 0.6}
        }
        d = speeds.get(timeControl, speeds['rapid'])
        time.sleep(d['hold'])
        pyautogui.moveTo(x1, y1, duration=d['move'])
        time.sleep(d['hold'])
        pyautogui.mouseDown()
        time.sleep(d['hold'])
        pyautogui.moveTo(x2, y2, duration=d['drag'])
        time.sleep(d['hold'])
        pyautogui.mouseUp()
    threading.Thread(target=do_autoplay).start()
    response = { 'bestMove': best }
    print('[bestmove] responding with:', response)
    return jsonify(response)

if __name__ == '__main__':
    print('Starting Python Chess Bot backend on http://localhost:5000')
    app.run(host='0.0.0.0', port=5000)
