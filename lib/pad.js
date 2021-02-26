module.exports = pad

function pad (count, text, left = true, char = ' ') {
  const deficit = count - text.length
  const pad = char.repeat(deficit)

  return deficit < 1
    ? text
    : left
      ? pad + text
      : text + pad
}
