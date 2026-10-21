package io.github.lucky2356.foodo.update;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * A small strict JSON parser (RFC 8259) for the GitHub release response.
 *
 * <p>Plain Java on purpose: the update decision is unit-tested without the Android SDK, where
 * org.json is only a stub. Objects become {@code Map<String, Object>}, arrays {@code List<Object>},
 * numbers {@link BigDecimal} (exact, so a size like 1.5 is detected as non-integral), JSON null
 * becomes {@code null}. Duplicate keys, trailing data and nesting deeper than {@link #MAX_DEPTH}
 * are rejected.
 */
final class MiniJson {

    static final int MAX_DEPTH = 64;

    private final String text;
    private int pos;

    private MiniJson(String text) {
        this.text = text;
    }

    static Object parse(String text) throws UpdateException {
        if (text == null) {
            throw bad("empty response");
        }
        MiniJson parser = new MiniJson(text);
        parser.skipWhitespace();
        Object value = parser.readValue(0);
        parser.skipWhitespace();
        if (parser.pos != text.length()) {
            throw bad("unexpected data after the JSON value at " + parser.pos);
        }
        return value;
    }

    private static UpdateException bad(String detail) {
        return new UpdateException(UpdateException.Code.BAD_RESPONSE, "Malformed JSON: " + detail);
    }

    private Object readValue(int depth) throws UpdateException {
        if (depth > MAX_DEPTH) {
            throw bad("nesting too deep");
        }
        if (pos >= text.length()) {
            throw bad("unexpected end");
        }
        char c = text.charAt(pos);
        switch (c) {
            case '{':
                return readObject(depth);
            case '[':
                return readArray(depth);
            case '"':
                return readString();
            case 't':
                expectWord("true");
                return Boolean.TRUE;
            case 'f':
                expectWord("false");
                return Boolean.FALSE;
            case 'n':
                expectWord("null");
                return null;
            default:
                if (c == '-' || (c >= '0' && c <= '9')) {
                    return readNumber();
                }
                throw bad("unexpected character at " + pos);
        }
    }

    private Map<String, Object> readObject(int depth) throws UpdateException {
        pos++; // {
        Map<String, Object> map = new LinkedHashMap<>();
        skipWhitespace();
        if (peek() == '}') {
            pos++;
            return Collections.unmodifiableMap(map);
        }
        while (true) {
            skipWhitespace();
            if (peek() != '"') {
                throw bad("object key expected at " + pos);
            }
            String key = readString();
            skipWhitespace();
            expectChar(':');
            skipWhitespace();
            Object value = readValue(depth + 1);
            if (map.containsKey(key)) {
                throw bad("duplicate key \"" + key + "\"");
            }
            map.put(key, value);
            skipWhitespace();
            char c = next();
            if (c == '}') {
                return Collections.unmodifiableMap(map);
            }
            if (c != ',') {
                throw bad("',' or '}' expected at " + (pos - 1));
            }
        }
    }

    private List<Object> readArray(int depth) throws UpdateException {
        pos++; // [
        List<Object> list = new ArrayList<>();
        skipWhitespace();
        if (peek() == ']') {
            pos++;
            return Collections.unmodifiableList(list);
        }
        while (true) {
            skipWhitespace();
            list.add(readValue(depth + 1));
            skipWhitespace();
            char c = next();
            if (c == ']') {
                return Collections.unmodifiableList(list);
            }
            if (c != ',') {
                throw bad("',' or ']' expected at " + (pos - 1));
            }
        }
    }

    private String readString() throws UpdateException {
        pos++; // opening quote
        StringBuilder sb = new StringBuilder();
        while (true) {
            char c = next();
            if (c == '"') {
                return sb.toString();
            }
            if (c < 0x20) {
                throw bad("control character in string at " + (pos - 1));
            }
            if (c != '\\') {
                sb.append(c);
                continue;
            }
            char e = next();
            switch (e) {
                case '"':
                case '\\':
                case '/':
                    sb.append(e);
                    break;
                case 'b':
                    sb.append('\b');
                    break;
                case 'f':
                    sb.append('\f');
                    break;
                case 'n':
                    sb.append('\n');
                    break;
                case 'r':
                    sb.append('\r');
                    break;
                case 't':
                    sb.append('\t');
                    break;
                case 'u':
                    sb.append(readHex4());
                    break;
                default:
                    throw bad("invalid escape at " + (pos - 1));
            }
        }
    }

    private char readHex4() throws UpdateException {
        if (pos + 4 > text.length()) {
            throw bad("truncated \\u escape");
        }
        int value = 0;
        for (int i = 0; i < 4; i++) {
            int digit = Character.digit(text.charAt(pos + i), 16);
            if (digit < 0) {
                throw bad("invalid \\u escape at " + pos);
            }
            value = value * 16 + digit;
        }
        pos += 4;
        return (char) value;
    }

    private BigDecimal readNumber() throws UpdateException {
        int start = pos;
        if (peek() == '-') {
            pos++;
        }
        if (peek() == '0') {
            pos++;
        } else if (isDigit(peek())) {
            while (isDigit(peek())) {
                pos++;
            }
        } else {
            throw bad("digit expected at " + pos);
        }
        if (peek() == '.') {
            pos++;
            if (!isDigit(peek())) {
                throw bad("digit expected at " + pos);
            }
            while (isDigit(peek())) {
                pos++;
            }
        }
        if (peek() == 'e' || peek() == 'E') {
            pos++;
            if (peek() == '+' || peek() == '-') {
                pos++;
            }
            if (!isDigit(peek())) {
                throw bad("digit expected at " + pos);
            }
            int expStart = pos;
            while (isDigit(peek())) {
                pos++;
            }
            // Refuse absurd exponents instead of building enormous BigDecimals.
            if (pos - expStart > 4) {
                throw bad("exponent too large at " + expStart);
            }
        }
        try {
            return new BigDecimal(text.substring(start, pos));
        } catch (NumberFormatException e) {
            throw bad("invalid number at " + start);
        }
    }

    private static boolean isDigit(char c) {
        return c >= '0' && c <= '9';
    }

    private void expectWord(String word) throws UpdateException {
        if (!text.startsWith(word, pos)) {
            throw bad("'" + word + "' expected at " + pos);
        }
        pos += word.length();
    }

    private void expectChar(char expected) throws UpdateException {
        if (next() != expected) {
            throw bad("'" + expected + "' expected at " + (pos - 1));
        }
    }

    private char peek() {
        return pos < text.length() ? text.charAt(pos) : '\0';
    }

    private char next() throws UpdateException {
        if (pos >= text.length()) {
            throw bad("unexpected end");
        }
        return text.charAt(pos++);
    }

    private void skipWhitespace() {
        while (pos < text.length()) {
            char c = text.charAt(pos);
            if (c != ' ' && c != '\t' && c != '\n' && c != '\r') {
                return;
            }
            pos++;
        }
    }
}
