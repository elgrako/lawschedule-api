/** Validacion de identificadores de recurso. Sin dependencias: testeable aislado. */
function isPositiveInt(v) {
    return /^\d+$/.test(String(v)) && Number(v) > 0 && Number.isSafeInteger(Number(v));
}
module.exports = { isPositiveInt };
