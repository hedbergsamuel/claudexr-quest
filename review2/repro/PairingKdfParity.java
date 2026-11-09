import javax.crypto.*; import javax.crypto.spec.*;
public class P { public static void main(String[] a) throws Exception {
 PBEKeySpec s = new PBEKeySpec(a[0].toCharArray(), ("claudexr-pair-v2|"+a[1]+"|"+a[2]).getBytes("UTF-8"), 200000, 256);
 byte[] k = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(s).getEncoded();
 StringBuilder sb=new StringBuilder(); for(byte b:k) sb.append(String.format("%02x",b)); System.out.println(sb); } }
