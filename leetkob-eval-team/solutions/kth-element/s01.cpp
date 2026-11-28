#include <iostream>
using namespace std;

int a[5005];

void swapVals(int& x, int& y) {
    int tmp = x;
    x = y;
    y = tmp;
}

int partitionLomuto(int lo, int hi) {
    int mid = lo + (hi - lo) / 2;
    swapVals(a[mid], a[hi]);
    int pivot = a[hi];
    int store = lo;
    for (int i = lo; i < hi; i++) {
        if (a[i] < pivot) {
            swapVals(a[store], a[i]);
            store++;
        }
    }
    swapVals(a[store], a[hi]);
    return store;
}

int quickSelect(int lo, int hi, int target) {
    if (lo == hi) return a[lo];
    int p = partitionLomuto(lo, hi);
    if (target == p) return a[p];
    if (target < p) return quickSelect(lo, p - 1, target);
    return quickSelect(p + 1, hi, target);
}

int main() {
    int n, k;
    if (!(cin >> n >> k)) return 0;
    for (int i = 0; i < n; i++) cin >> a[i];
    cout << quickSelect(0, n - 1, k - 1) << '\n';
    return 0;
}
