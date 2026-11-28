/* Agent Chess — AI worker (development build).
 *
 * In the packaged single-file build this file is replaced by an inlined
 * Blob worker (window.AC_WORKER_SOURCE) so it also works from file://.
 */
importScripts('../core/constants.js', '../core/engine.js', 'eval.js', 'search.js');

self.onmessage = function (event) {
  const msg = event.data || {};
  try {
    const state = AC.Engine.fromFen(msg.fen);
    const result = AC.Search.findBestMove(state, {
      level: msg.level,
      depth: msg.depth,
      timeMs: msg.timeMs
    });
    self.postMessage({
      id: msg.id,
      move: result.move,
      best: result.best,
      score: result.score,
      depth: result.depth,
      nodes: result.nodes,
      timeMs: result.timeMs
    });
  } catch (err) {
    self.postMessage({ id: msg.id, error: String((err && err.message) || err) });
  }
};
