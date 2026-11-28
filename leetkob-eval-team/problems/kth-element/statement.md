# k-th smallest element with quickselect

You are given `n` integers and an integer `k` (1 ≤ k ≤ n). Print the `k`-th smallest integer
when the array is arranged in non-decreasing order (counting duplicates, 1-based).

## Input
- Line 1: `n` and `k` (1 ≤ k ≤ n ≤ 5000), separated by a space.
- Line 2: `n` integers `a_i` (|a_i| ≤ 10^9), separated by spaces.

## Output
One line containing the `k`-th smallest integer.

## Example
Input
```
6 3
5 -2 9 -2 0 7
```
Output
```
0
```

## Limits
Time limit: 2 seconds. Memory limit: 256 MB. Compiled with `g++ -std=c++17 -O2`.

## Constraints
The lab constraints and their deductions are in `constraints.json`. A submission is Accepted when it passes every test; the constraints are checked separately, before grades are published.
