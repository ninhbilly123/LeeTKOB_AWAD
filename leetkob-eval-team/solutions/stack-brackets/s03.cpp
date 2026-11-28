#include <iostream>
#include <stack>
#include <string>
using namespace std;

bool isBalanced(const string& s) {
    std::stack<char> st;
    for (char c : s) {
        if (c == '(' || c == '[' || c == '{') {
            st.push(c);
        } else {
            if (st.empty()) return false;
            char open = st.top();
            st.pop();
            if ((c == ')' && open != '(') ||
                (c == ']' && open != '[') ||
                (c == '}' && open != '{')) {
                return false;
            }
        }
    }
    return st.empty();
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
