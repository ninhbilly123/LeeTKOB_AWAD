#include <iostream>
#include <string>
using namespace std;

// Lab forbids std::stack, std::vector, std::deque, and std::list,
// so we implement our own raw linked-node stack in namespace my.
namespace my {
    struct Node {
        char ch;
        Node* next;
    };

    struct stack {
        Node* head = nullptr;
        const char* label = "manual linked stack (not std::stack or std::vector)";

        void push(char c) {
            head = new Node{c, head};
        }

        bool empty() const {
            return head == nullptr;
        }

        char pop() {
            Node* old = head;
            char val = old->ch;
            head = old->next;
            delete old;
            return val;
        }

        ~stack() {
            while (!empty()) pop();
        }
    };
}

bool checkLine(const string& s) {
    my::stack st;
    for (char c : s) {
        if (c == '(' || c == '[' || c == '{') {
            st.push(c);
        } else {
            if (st.empty()) return false;
            char open = st.pop();
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
        cout << (checkLine(s) ? "YES" : "NO") << '\n';
    }
    return 0;
}
