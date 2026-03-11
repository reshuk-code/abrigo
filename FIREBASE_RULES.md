## Firebase Realtime Database Rules

```json
{
  "rules": {
    "users": {
      "$username": {
        ".read": "true",
        ".write": "!data.exists()",
        "email": {
          ".write": "true"
        },
        "publicKey": {
          ".write": "true"
        }
      }
    },
    "phone_index": {
      "$phoneHash": {
        ".read": "true",
        ".write": "!data.exists()"
      }
    },
    "chats": {
      "$chatId": {
        ".read": "true",
        ".write": "true"
      }
    },
    "otps": {
      ".read": "false",
      ".write": "false"
    }
  }
}
```
