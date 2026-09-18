// 必須是測試檔的第一個 import。
// 在 src/db 被求值之前改用記憶體資料庫,不碰 data/tasks.db;
// import 依出現順序求值,所以這行一定比 db 的連線先跑
process.env.TASKS_DB_PATH = ':memory:'
