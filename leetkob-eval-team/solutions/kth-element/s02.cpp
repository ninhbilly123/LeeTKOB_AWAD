#include <algorithm>
#include <iostream>
using namespace std;

// We include <algorithm> strictly for std::swap (never std::nth_element or std::sort).
namespace custom {
    int nth_element(int* arr, int n, int target) {
        int lo = 0;
        int hi = n - 1;
        while (lo < hi) {
            int pivot = arr[lo + (hi - lo) / 2];
            int i = lo;
            int j = hi;
            while (i <= j) {
                while (arr[i] < pivot) i++;
                while (arr[j] > pivot) j--;
                if (i <= j) {
                    std::swap(arr[i], arr[j]);
                    i++;
                    j--;
                }
            }
            if (target <= j) {
                hi = j;
            } else if (target >= i) {
                lo = i;
            } else {
                return arr[target];
            }
        }
        return arr[lo];
    }
}

int a[5005];

int main() {
    int n, k;
    if (!(cin >> n >> k)) return 0;
    for (int i = 0; i < n; i++) cin >> a[i];
    cout << custom::nth_element(a, n, k - 1) << '\n';
    return 0;
}
