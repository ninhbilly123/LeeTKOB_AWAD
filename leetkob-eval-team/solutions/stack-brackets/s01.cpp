#include <iostream>
#include <string>
using namespace std;

bool isBalanced(const string& s) {
    char st[2005];
    int top = 0;
    for (char c : s) {
        if (c == '(' || c == '[' || c == '{') {
            st[top++] = c;
        } else {
            if (top == 0) return false;
            char open = st[--top];
            if ((c == ')' && open != '(') ||
                (c == ']' && open != '[') ||
                (c == '}' && open != '{')) {
                return false;
            }
        }
    }
    return top == 0;
}

int main() {
    int q;
    if (!(cin >> q)) return 0;
    string s;
    for (int i = 0; i < q; i++) {
        cin >> s;
        cout << (isBalanced(s) ? "YES" : "NO") << '\n';
    }
    return 0;
}
