import {
  Wallet,
  CrossClient,
  Exchange,
  Network,
  utils,
  types,
  constants,
} from "@zetamarkets/sdk";
import { PublicKey, Connection, Keypair } from "@solana/web3.js";
import base58 from "bs58";
import { defaultCommitment, sleep } from "@zetamarkets/sdk/dist/utils";

const RPC_URL = "https://api.mainnet-beta.solana.com"
// now函数为chatgpt生成
function now() {
  let now = new Date();
  let year = now.getFullYear(); // 年
  let month = now.getMonth() + 1; // 月份（0-11，所以加1）
  let day = now.getDate(); // 日
  let hour = now.getHours(); // 小时
  let minute = now.getMinutes(); // 分钟
  let second = now.getSeconds(); // 秒

  // 格式化时间，确保每个时间单位至少有两位数字
  let formattedTime = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')} ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:${second.toString().padStart(2, '0')}`;
  return formattedTime;
}

function shuffleArray<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

let a_private = [
    //此处放第一组私钥
]
let b_private = [
    // 此处放第二组私钥
]

const connection = new Connection(RPC_URL, "confirmed")
// 设置每计算单元费用
let fee = 15000
Exchange.updatePriorityFee(fee)

async function get_client(private_key_str: string) {
    let private_key_bytes = base58.decode(private_key_str)
    let userKey = Keypair.fromSecretKey(private_key_bytes)

    // 私钥钱包
    let wallet = new Wallet(userKey)

    const client = await CrossClient.load(
      connection,
      wallet,
      { skipPreflight: true, commitment: "confirmed" }
      // , clientCallback
    );
    return client
}

async function order(client: CrossClient, tradingAsset: constants.Asset, order_price: number, side: types.Side, size: number) {
    // 下单
    try {
        let result = await client.placeOrder(
          tradingAsset, 
          utils.convertDecimalToNativeInteger(order_price), 
          utils.convertDecimalToNativeLotSize(size),
          side, 
          { tifOptions: {}, orderType: types.OrderType.IMMEDIATEORCANCEL })
        // 读取持仓
        let positions = client.getPositions(tradingAsset)
        for (let i in positions) {
          let position = positions[i]
          return position['size']
        }
        return 0
    } catch (error) {
        return 0
    }
}

async function get_position(client: CrossClient, tradingAsset: constants.Asset) {
    // 读取持仓
    let positions = client.getPositions(tradingAsset)
    for (let i in positions) {
      let position = positions[i]
      return position['size']
    }
    return 0
}

async function main() {
    let tradingAsset = constants.Asset.SOL;

    let loadExchangeConfig = types.defaultLoadExchangeConfig(
      Network.MAINNET,
      connection,
      utils.defaultCommitment(),
      0,
      true,
      undefined,
      [tradingAsset],
      undefined,
      [tradingAsset]
    );

   await Exchange.load(loadExchangeConfig)

   // 这里修改每次下单数量
   let size = 1
   // 这里修改交易次数（每次对冲 一开一平算一次）
   let max_trades = 100
   
   for (let l = 0; l < 100; l ++) {
     let a_list = shuffleArray(a_private)
     let b_list = shuffleArray(b_private)
     let op_mask = 0

     //遍历A组同时取b组中对应的私钥
     //分派买单 卖单私钥
     console.log("开始开仓")
     for(let i = 0; i < a_list.length; i++) {
        //获取一组对应的私钥
        let buy_key = b_list[i]
        let sell_key = a_list[i]
        if (op_mask == 0) {
            buy_key = a_list[i]
            sell_key = b_list[i]
        }

        // 读取盘口价格 确定买卖价格
        let order_book = Exchange.getOrderbook(tradingAsset)
        let sell_price = order_book.bids[0].price
        let buy_price = order_book.asks[0].price
        console.log(buy_price + " " + sell_price)

        // 初始化客户端
        let buy_client = await get_client(buy_key)
        let sell_client = await get_client(sell_key)
        
        // 批量下单 并获取持仓量
        let [buy_order, sell_order] = await Promise.all([
            order(buy_client, tradingAsset, buy_price, types.Side.BID, size),
            order(sell_client, tradingAsset, sell_price, types.Side.ASK, size)
        ]);

        console.log(buy_key + " 开多 持仓:" + buy_order)
        console.log(sell_key + " 开空 持仓:" + sell_order)

        for (let t = 0; t < 10; t++) {
          // 读取盘口价格
          let order_book = Exchange.getOrderbook(tradingAsset)
          let sell_price = order_book.bids[0].price
          let buy_price = order_book.asks[0].price

          if (buy_order > 0 && sell_order < 0) {
              break
          }

          //检查结果
          if (buy_order == 0) {
              buy_price = order_book.asks[2].price
              buy_order = await order(buy_client, tradingAsset, buy_price, types.Side.BID, size)
              console.log(buy_key + " 重试开多 持仓:" + buy_order)
          }
          if (sell_order == 0) {
              sell_price = order_book.bids[2].price
              sell_order = await order(sell_client, tradingAsset, sell_price, types.Side.ASK, size)
              console.log(sell_key + " 重试开空 持仓:" + sell_order)
          }
        }

        buy_client.close()
        sell_client.close()
        await sleep(30000)
     }
     if (op_mask == 0) {
      op_mask = 1
     } else {
      op_mask = 0
     }

     console.log("开始平仓")
     //开始平仓逻辑
     a_list = shuffleArray(a_private)
     b_list = shuffleArray(b_private)
     for(let i = 0; i < a_list.length; i++) {
        let a_key = b_list[i]
        let b_key = a_list[i]

        // 读取盘口价格 确定买卖价格
        let order_book = Exchange.getOrderbook(tradingAsset)
        let sell_price = order_book.bids[5].price
        let buy_price = order_book.asks[5].price
        console.log(buy_price + " " + sell_price)

        // 初始化客户端
        let a_client = await get_client(a_key)
        let b_client = await get_client(b_key)

        let a_position = await get_position(a_client, tradingAsset)
        let b_position = await get_position(b_client, tradingAsset)
        if (a_position > 0) {
          console.log(b_key + " 准备平多a 剩余:" + a_position)
          let pos = await order(a_client, tradingAsset, sell_price, types.Side.ASK, a_position)
          console.log(a_key + " 平多a 剩余:" + pos)
        } else if(a_position < 0){
          console.log(b_key + " 准备平空a 剩余:" + a_position)
          let pos = await order(a_client, tradingAsset, buy_price, types.Side.BID, a_position * -1)
          console.log(a_key + " 平空a 剩余:" + pos)
        }
        
        if (b_position > 0) {
          console.log(b_key + " 准备平多b 剩余:" + b_position)
          let pos = await order(b_client, tradingAsset, sell_price, types.Side.ASK, b_position)
          console.log(b_key + " 平多b 剩余:" + pos)
        } else if(b_position < 0){
          console.log(b_key + " 准备平空b 剩余:" + b_position)
          let pos = await order(b_client, tradingAsset, buy_price, types.Side.BID, b_position * -1)
          console.log(b_key + " 平空b 剩余:" + pos)
        }


        a_client.close()
        b_client.close()
        await sleep(30000)
     }
  }
}

main().catch(console.error.bind(console));
