// A 32 x 24 baseline JPEG (4:2:0, quality 85: a red disc, a blue block and a
// black diagonal on white) and its RGB decode by libjpeg-turbo 3.1.4 (Pillow
// 12.3, default ISLOW IDCT with fancy chroma upsampling), the decoder family
// Chromium and Electron use. It bounds how far the headless trace command's
// JPEG decode (pdf.js) sits from the app's browser decode (ADR-477).

export const JPEG_FIXTURE_WIDTH = 32;
export const JPEG_FIXTURE_HEIGHT = 24;

export const JPEG_FIXTURE_BASE64 = [
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQa',
  'FRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4e',
  'Hh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCAAYACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAA',
  'AAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAk',
  'M2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKT',
  'lJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QA',
  'HwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdh',
  'cRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hp',
  'anN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk',
  '5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD6g+J/jvR/APh86lqTedcy5Wzs0bEly47D0UZG5sYAI6kqD4L/',
  'AMNK+K/7T8z+wdF+wedu8nEvm+Vu+75m/G7HG7ZjPO3tR+2N9u/4TnR/M+0/YP7M/c7t3leb5r+Zt7bseVuxzjZn',
  'tXzb4k1qERS6dYqby9K5KxkFIsMB85zxz29eOMivOUq2IxscPBtJtLRXer3t19Oux+g5flmW4TKHjcTFTk03Zu21',
  '7RXbbV629D7z0D4yeBb7wI/izVdbs9Eht/kvILuYCSGXYz+Wo6ylgjlNgJcKQBuDKOV0zWPib8YLi01HQWvPh14D',
  'P2S+tb+aCN9X1XbJuZFTeyQwsB1ZW3gIcSRyOg+GLewJmFzeyefODuQchI+Oij+vsO9ewfso/wDJfvDX/b1/6SzV',
  '9++Ea1LCzr1anwpu3Lq7K+vvNJvyb/Q/Nq2PpVK/7mFot7Xvb52V/u/zPZ/Euj+MP2j7S0mhsD4F8DpHFeaZqd7a',
  'rJq9+zZDhUSXEMDDByTltsTDcrELydz+yv4ptLS407RdU8Ora+YTE0ssyM43cMw8tsMQBxubHTJAoor5CmvZ1oVo',
  '/FFpr1Wqv3PXoZjXoUZ0Yv3ZJx1V7J72fS/kZv8Awyp8Q/8AoM+Fv/Amf/4zXZ/BL9n/AMZeCPifpHifVdT0Cazs',
  'vO8xLaeZpDvgkjGA0Sjq47jjNFFfR1+KMfXpSpTatJNPTo9Dxo4SnFpo/9k=',
].join('');

/** Row-major RGB, 3 bytes per pixel, from libjpeg-turbo. */
export const JPEG_FIXTURE_LIBJPEG_TURBO_RGB_BASE64 = [
  '6v//9/////n2//r0//77+f//9///9f///v////v///v///r/+vz/+f//+f/2/P/6//z/+vv/9f/78v/09P/29P/5',
  '//3///j///r///n///z5/P/49v/z8v7w/P/2+fzx9P//+f////329erk//7/9Pn97/n6/P////v8//j9/+v4//X/',
  '//r7/fPx//36//v+//j//fr/+//69//27vvx+f/9+/j///v///r///z//f7/9fv5+f/7+//6AAEA///6+Pb7+ff4',
  '///2/v/6/f3//v7/9/n0//70//bz/+/z/+b2/+fu//De//Tk//H9//L///f///Tz//32//z1/P//+Pz7//v4//r5',
  '//f8//3/+P//9v///P//AQEBFQ8RDgUI//r///v8+f/18/31+Pz//Pn///vz/+zd/+rkkzAznio3nywxlDUfjDci',
  'iTM8/+f4/+rp//Xx/uXp//n///3/+vv///77//35//79+fj+9fn/AAYSAgMIFhQZBgAE//r///j5//X0///7+f/9',
  '+P////Xz/+7jn0E1ricjwCYouiMsvCotuy0jtikYuSshqiohmzsv/+vq/+P6//X///r//Pz/+///+///+Pj4//79',
  'Eg0HEQ4JCAkL/v////n///f///v9//z9///9+Pfz//f2//HsoD82rCQYzCQbzRsXwB0evBsgwBocxxsZyx0UyCYZ',
  'pB4SmjIv/+f7/+3///L//v//8/389///BgwIDRAJCQcACggA/v78+vn+//r///n//v//8PHz+/////Px/+vtpzk6',
  'sRwYyB0Tyh0NxyAQvyYgvSQnxR4vzRwu0BgkzRgd0CgltCQckSEd/+rk//nv9Pjq9//0AA0ABBIFAA8C8v/2+P/6',
  '+vn0//v///j//e7//Pr///7////7//XzkCgvuyQrzB0a2SMYzCEQwB4RyC0ouR0hwBcqyyZGsRxGrSRQpR5GpC1J',
  'lTtHczg6//rzCg8IAQwQAA8cAAwg7v//6v//6///+Pz/+fP///T///n///X///L///v2//HqoCMryCMqzB8YyyES',
  'viIWxCciziUoxhghyBwqtClQWhJkPxuHOBaHPSSKMSZyLy1eBAQcAwQgBghBKC9/Hi2KGSySGC+XFSuYFyyfHyyK',
  '+vn///r///P///b///XwgTgxuCgxzh0lxhkSwxsQxygltxYbyBsfzyAlxBsgniZJPB95HzCmHi+lGCqWAApkAAJM',
  'Bw1LAgBJKSWTGxufGiexEim1ECy7Cym7Dyq/GCyf9vr///7/+/////T3//DsmDAtwiEp0hkhzRsZ1CQkxhQg4TE8',
  'uREQxyQdwCMcmi4+PShpGi9+ITJoAAQ0AghCAABNJCaNIyCjJh+9KCXKGCa7DCu3BDK8Ay65ESu2HyuR9/3//v/2',
  '9v/9//v4/+3poTMywRwi0RYd0iQjxhYZ0xQmyA4cyCAduiQWuS8kji81RzJdAAM4AAcyAgk3AgVIJimGKjCsGR20',
  'IB3MHiDNFie9Diu1BjG7Bi24FCm2ISqP9v7//P/t/v72//v0//Drlzg2ux8izBkcyygjwhgZ2xYn1A8gzycnuC4k',
  'oTIphz0+GQAQDAQ1BQBQIyWMFCCWIDKuDiKfFymvGSjBEB68Fim2EymyFCu1Eie4Fya/Himc8///+f/v//v4//Lw',
  '//PxiDY4tyYrxx8fvSMZySsizRUfzRsnsyUknCslQQAANwAHFQAjCQNNJiOUHiatHzTFDCe0CyimHDe4Eym7FSjC',
  'Fii6Fie1GSi3GCS4GiTDHyif9P3/+f/6//T6//b7//P3fjc9rys4wiMntyEQtSIOuiYksC8zjDMvQwAAQQABJQAd',
  'KyaKFSirFSexFyy7ARqyDCq8Fje6AR+jHTDMEh/FFyTIFiTDFyjAFSW5HSS9JCad+Pn//v7///f///L8//X9/+z0',
  'miQyuikutCsYrS8YnC8oSgAAQAAANAAAQAAAf0N2HRiWFy/PDie/Ei3CEzDKDSvBCSmwDyy2FCfDFiXKFyTIFSTH',
  'FSfFFSPBHiO9JSac9/r//P///v////r///L4//D2mzY+pSkrqjQmlDMiOQAAOQAAQAAAoDc0qi80iClVOR2UFyS+',
  'Eie+DinADyjDDyjCDym6ECm5Eie+EybADiK3GS3EFiXKFiHIJyvMEReH9P//9P/y+P//+v/+//7///b6/+PulztA',
  'RQAAQgAANAAAOwAAqzUztSUktiElpjVgOReIICq/FSm+EirAFCnEFCnCFSm8FSm8FSm+FSm8GS67FCa4Eh/DFx/I',
  'HyPEKS+f8P//7//s9//q+//z+P/9/fv///X/IAAANAAAQAAAkz1ApDAzuhYVzRsbvhohlSRPRymZDh2uFSe5Eye6',
  'FSa6Fia6Fya3Fya3Fia6Fia5ECKsFiWyISvIICXHHBy6IiWW7/z/9P/7+v/o+//v5PHoDRcZDAgWIQ8bGAAAekRC',
  'fyotqzQ4yioqxBwcuyoxkjJXLhZ2IS+sGSinGSinGienGienHCelHCenGieqGiepIC6oIS+pGiSoGR+pMC+3ISOI',
  '9f7/7fn3+f/z+f/0Fx4XAAIDAAEG//3///74//jx//DthDQ1njIynCoqlTc4djhRPipvJCmEIi2JIC2JIi2HIi2G',
  'IyyHIyyLIiuQIiyOFyV9Hy6DHCmFGSGDKy2RLS957/b/+f/7Cw0IAAEABwMAFhUT/P/99v32+//2///y//j0/+nr',
  '/+zv/+vv//Hx//H9//j/7PL/8fr/8Pv/8fv/8fv/8/r/8/n/8fj/8Pn/8P3/8P7/8P3/8vv/8/f/7/L/+///+f/z',
  'EgQTHw8a//j7//34/f/z+P/z7v/s+P/0//36//r///P///H8+/Lz/v//+f//9f//9f//9///+P//+P//+f7/+f3/',
  '+Pz/9/3/8Pv/7vz/8///9f//8Pb/+/7/9/z2/v/xFwAX//X///j9//30+Pvq9//t8f/w8v/0+////v7///3/9vj/',
  '9///7//47f3y9f/6+P//+P//+//9+//9/P//+///+/7/+P//+P//9///9P/69P/7+f///P///P/0/v/u',
].join('');
