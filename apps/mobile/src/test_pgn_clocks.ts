import { Chess } from 'chess.js';

const pgn = `[Event "Tata Steel Masters"]
[Site "Wijk aan Zee"]
[Date "2026.01.23"]
[Round "1"]
[White "Player A"]
[Black "Player B"]
[Result "*"]

1. e4 {[%clk 1:40:00]} e5 {[%clk 1:40:00]} 2. Nf3 {[%clk 1:39:55]} Nc6 {[%clk 1:39:50]} *`;

// Current logic simulation
let cleanPgn = pgn.replace(/\{[\s\S]*?\}/g, '');
console.log('Cleaned PGN:', cleanPgn);

const chess = new Chess();
chess.loadPgn(cleanPgn);
console.log('Last Move:', chess.history().pop());
// Expected: Comments gone, no clock data.

// Proposed Logic validation
const chess2 = new Chess();
// We need to parse comments.
// If we load the raw PGN with chess.js, does it keep comments?
chess2.loadPgn(pgn);
const history = chess2.history({ verbose: true });
const comments = chess2.getComments();
console.log('Comments:', comments); 
// Note: chess.js getComments() might act differently depending on version.
// Let's see if we can just regex the raw string for the last clocks.

function extractClocks(pgn: string) {
    // simplified regex for demo
    const matches = [...pgn.matchAll(/\[%clk\s+(\d+:\d+(?::\d+)?)]/g)];
    const last = matches[matches.length - 1];
    const secondLast = matches[matches.length - 2];
    console.log('Extracted Clocks:', last ? last[1] : 'none', secondLast ? secondLast[1] : 'none');
}
extractClocks(pgn);
