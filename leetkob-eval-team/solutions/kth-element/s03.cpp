#include <algorithm>
#include <iostream>
using namespace std;

#define SELECT_RANGE std::partial_sort

int partitionSelect(int* a, int n, int k) {
    SELECT_RANGE(a, a + k, a + n);
    return a[k - 1];
}

int a[5005];

int main() {
    int n, k;
    if (!(cin >> n >> k)) return 0;
    for (int i = 0; i < n; i++) cin >> a[i];
    cout << partitionSelect(a, n, k) << '\n';
    return 0;
}
