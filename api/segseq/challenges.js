export default function handler(req, res) {
  return res.status(200).json({
    ok: true,
    msg: "THIS IS THE REAL FILE"
  });
}
