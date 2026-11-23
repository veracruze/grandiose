FONTS FOR THE THEME (chrome/fonts/)

Put the files below in this folder. Nothing has to be installed on the computer.
A missing file is fine: that language falls back to Firefox's own font, so add them one at a time.
Every font here is SIL Open Font License, which allows shipping them with a shared theme.

Where to get them: fonts.google.com, search the family name, "Get font" > "Download all".
Inside the zip, open the "static" folder and copy the "...-Black.ttf" file. Keep the file name exactly.

ALWAYS (Latin, Turkish and other Latin languages, Cyrillic, Vietnamese)
  Nunito-Black.ttf *            family: Nunito
  Poppins Thin.ttf **           family: Poppins
  Poppins ExtraLight.ttf **     family: Poppins
  Poppins Light.ttf **          family: Poppins
  Poppins Regular.ttf **        family: Poppins
  (*:Used by the user defined/firefox default theme)
  (**:Used by about:newtab)
OTHER ALPHABETS (small files)
  NotoSans-Black.ttf            family: Noto Sans              Greek
  NotoSansHebrew-Black.ttf      family: Noto Sans Hebrew       Hebrew
  NotoSansArabic-Black.ttf      family: Noto Sans Arabic       Arabic, Persian, Urdu
  NotoSansThai-Black.ttf        family: Noto Sans Thai         Thai
  NotoSansDevanagari-Black.ttf  family: Noto Sans Devanagari   Hindi, Marathi, Nepali

JAPANESE / CHINESE / KOREAN (large files, several MB each; only add the ones you need)
  NotoSansJP-Black.ttf          family: Noto Sans JP           Japanese
  NotoSansSC-Black.ttf          family: Noto Sans SC           Chinese, simplified
  NotoSansTC-Black.ttf          family: Noto Sans TC           Chinese, traditional
  NotoSansKR-Black.ttf          family: Noto Sans KR           Korean
  Rounder Japanese option: M PLUS Rounded 1c, file MPLUSRounded1c-Black.ttf; then change the file
  name in the "UC JP" rule in css/00-fonts.css.
  
  

Other languages (Armenian, Georgian, Bengali, Tamil ...): not bundled; Firefox's own font is used.
To add one, copy an "UC Sans" block in css/00-fonts.css, give it the script's unicode-range and the
matching Noto Sans file.
