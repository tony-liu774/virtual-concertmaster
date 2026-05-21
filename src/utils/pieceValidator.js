/**
 * ─────────────────────────────────────────────────────────────
 *  Piece Validator — "Data Gatekeeper"
 *
 *  All pieces (built-in AND uploads) must pass this check before
 *  entering the library display array.  A piece is valid when:
 *
 *   ✔  Has a non-empty string id, title, clef, timeSignature
 *   ✔  Has a non-empty measures array
 *   ✔  Every note in every measure has at minimum a vexKey OR (midi + freq)
 *
 *  Usage
 *    import { validatePiece, gatekeeperAdd } from './pieceValidator.js';
 *
 *    const result = validatePiece(piece);   // { valid, errors }
 *    const safe   = gatekeeperAdd(piece);   // returns piece | null
 * ─────────────────────────────────────────────────────────────
 */

/**
 * Validate a piece object.
 * @param {object} piece
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validatePiece(piece) {
  const errors = [];

  if (!piece || typeof piece !== 'object') {
    errors.push('Piece is null or not an object.');
    return { valid: false, errors };
  }

  if (!piece.id    || typeof piece.id    !== 'string') errors.push('Missing or invalid id.');
  if (!piece.title || typeof piece.title !== 'string') errors.push('Missing or invalid title.');
  if (!piece.clef)          errors.push('Missing clef.');
  if (!piece.timeSignature) errors.push('Missing timeSignature.');

  if (!Array.isArray(piece.measures)) {
    errors.push('measures must be a non-empty array.');
  } else {
    const notationData = piece.measures.flat();

    if (notationData.length === 0) {
      errors.push('Notation data is empty — no notes found in any measure.');
    } else {
      // Every note needs either a vexKey (for rendering) or midi+freq (for
      // pitch detection).  A note missing both can't be displayed or evaluated.
      const malformed = notationData.filter(
        n => !n?.vexKey && !(n?.midi != null && n?.freq != null)
      );
      if (malformed.length > 0) {
        errors.push(
          `${malformed.length} note(s) are missing vexKey / freq data.`
        );
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Gate-kept add — returns the validated piece or null.
 * Logs a detailed error to the console on failure.
 *
 * @param {object} piece
 * @returns {object|null}
 */
export function gatekeeperAdd(piece) {
  const { valid, errors } = validatePiece(piece);

  if (!valid) {
    console.error(
      '[Piece Gatekeeper] Validation failed — piece blocked from library.\n' +
      `  id: ${piece?.id ?? '(none)'}\n` +
      `  Errors: ${errors.join(' | ')}`
    );
    return null;
  }

  return piece;
}
