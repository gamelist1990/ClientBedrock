import Head from "next/head"
import { useRouter } from "next/navigation"
import { title } from "process"

export default function Home() {

  const router = useRouter()

  const show = async () => {
    await alert({
      title: "アラート",
      message: "メッセージを表示します",
      
    })
  }


  return (
    <>
      <Head>
        <title>簡単なForm</title>
        <meta name="description" content="便利なライブラリのテストページ" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <div className="MainForm">
        <h1>簡単なForm</h1>
        <p>実験だよ</p>
        <button onClick={show}> hello</button>
      </div>
      
    </>
  );
}