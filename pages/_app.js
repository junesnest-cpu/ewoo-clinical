import Head from 'next/head';

export default function App({ Component, pageProps }) {
  return (
    <>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>이우병원 임상서식</title>
        <style>{`
          * { margin:0; padding:0; box-sizing:border-box; }
          body { font-family: 'Noto Sans KR', -apple-system, sans-serif; background: #f1f5f9; color: #1e293b; }
          a { color: inherit; text-decoration: none; }
        `}</style>
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />
      </Head>
      <Component {...pageProps} />
    </>
  );
}
