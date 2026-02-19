/// Compares two equal-sized byte slices in constant time.
///
/// Returns `true` if the slices are equal, `false` otherwise.
#[inline]
pub fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut res = 0;
    for i in 0..a.len() {
        res |= a[i] ^ b[i];
    }
    res == 0
}
