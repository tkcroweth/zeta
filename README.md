# zeta
ZETA Automated hedging transactions

# INSTALL
```
npm install -g ts-node
npm install @zetamarkets/sdk
npm install bs58
```

# How to RUN
```
//Modify two sets of private keys.
let a_private = [
    //此处放第一组私钥
]
let b_private = [
    // 此处放第二组私钥
]
//Modify order size and max trades
let size = 1
let max_trades = 100
// RUN in commands
ts-node run.ts
```