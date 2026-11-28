# Balanced brackets with a manual stack

You are given `q` non-empty strings consisting only of bracket characters `(`, `)`, `[`, `]`, `{`, `}`.
For each string, print `YES` if the brackets are properly balanced and nested, or `NO` otherwise.

## Input
- Line 1: `q` (1 ≤ q ≤ 200).
- Next `q` lines: each line contains one non-empty bracket string `s` (1 ≤ |s| ≤ 2000).

## Output
`q` lines: `YES` or `NO` for each string in order.

## Example
Input
```
4
()[]{}
([)]
{[()]}
(((
```
Output
```
YES
NO
YES
NO
```

## Limits
Time limit: 2 seconds. Memory limit: 256 MB. Compiled with `g++ -std=c++17 -O2`.

## Constraints
The lab constraints and their deductions are in `constraints.json`. A submission is Accepted when it passes every test; the constraints are checked separately, before grades are published.
