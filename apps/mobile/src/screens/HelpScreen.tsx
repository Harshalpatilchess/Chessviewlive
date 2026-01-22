import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, Alert, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { broadcastTheme } from '../theme/broadcastTheme';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { useState } from 'react';
import { SUPPORT_RELAY_URL, SUPPORT_SECRET } from '../config/supportConfig';
import Constants from 'expo-constants';

type Props = NativeStackScreenProps<RootStackParamList, 'Help'>;

export default function HelpScreen({ navigation }: Props) {
    const [email, setEmail] = useState('');
    const [message, setMessage] = useState('');
    const [isSending, setIsSending] = useState(false);
    const [debugInfo, setDebugInfo] = useState('');

    const handleSend = async () => {
        // Validate inputs
        if (!email.trim()) {
            Alert.alert('Required', 'Please enter your Gmail ID');
            return;
        }

        if (!message.trim()) {
            Alert.alert('Required', 'Please enter a message');
            return;
        }

        setIsSending(true);
        setDebugInfo('');

        try {
            // Prepare payload with metadata
            const payload = {
                userEmail: email.trim(),
                message: message.trim(),
                appVersion: Constants.expoConfig?.version || '1.0.0',
                platform: Platform.OS,
                timestamp: new Date().toISOString(),
            };

            // Send to backend relay
            const response = await fetch(SUPPORT_RELAY_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-APP-SECRET': SUPPORT_SECRET,
                },
                body: JSON.stringify(payload),
            });

            // Read raw text first (don't assume JSON)
            const rawText = await response.text();
            const preview = rawText.substring(0, 300);

            // Dev-only comprehensive logging
            console.log(`[Help] status=${response.status} body=${preview}`);

            // Check if response looks like JSON (starts with "{")
            if (rawText.trim().startsWith('{')) {
                // Attempt to parse JSON
                try {
                    const result = JSON.parse(rawText);

                    // Check if json.ok === true
                    if (result.ok === true) {
                        // Success - clear debug, show "Sent", clear only message field
                        setDebugInfo('');
                        Alert.alert('Sent', 'Your message has been sent. We\'ll get back to you soon!', [
                            {
                                text: 'OK',
                                onPress: () => {
                                    // Clear only message field (keep email filled)
                                    setMessage('');
                                },
                            },
                        ]);
                    } else {
                        // JSON parsed but ok !== true - show friendly error
                        const errorMsg = result.error || 'Failed to send message';
                        setDebugInfo(`Debug: status=${response.status} body starts: ${rawText.substring(0, 50)}...`);
                        Alert.alert(
                            'Couldn\'t send',
                            'Unable to send your message. Please try again later.',
                            [{ text: 'OK', style: 'default' }]
                        );
                    }
                } catch (parseError) {
                    // JSON parse failed - show friendly error
                    console.log('[Help] JSON parse failed:', parseError);
                    setDebugInfo(`Debug: status=${response.status} body starts: ${rawText.substring(0, 50)}...`);
                    Alert.alert(
                        'Couldn\'t send',
                        'Unable to send your message. Please try again later.',
                        [{ text: 'OK', style: 'default' }]
                    );
                }
            } else {
                // Non-JSON body - show friendly error
                console.log('[Help] Non-JSON response received');
                setDebugInfo(`Debug: status=${response.status} body starts: ${rawText.substring(0, 50)}...`);
                Alert.alert(
                    'Couldn\'t send',
                    'Unable to send your message. Please try again later.',
                    [{ text: 'OK', style: 'default' }]
                );
            }
        } catch (error) {
            console.log('[Help] Error:', error);
            setDebugInfo(`Debug: Network or fetch error`);
            Alert.alert(
                'Couldn\'t send',
                'Unable to send your message. Please try again later.',
                [{ text: 'OK', style: 'default' }]
            );
        } finally {
            setIsSending(false);
        }
    };

    return (
        <View style={styles.container}>
            <StatusBar style="light" />

            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity
                    style={styles.backButton}
                    onPress={() => navigation.goBack()}
                >
                    <Ionicons name="arrow-back" size={24} color={broadcastTheme.colors.slate200} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Help</Text>
                <View style={styles.headerSpacer} />
            </View>

            {/* Content */}
            <KeyboardAvoidingView
                style={styles.content}
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                keyboardVerticalOffset={100}
            >
                <ScrollView
                    style={styles.scrollView}
                    contentContainerStyle={styles.scrollContent}
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                >
                    {/* Email Input */}
                    <View style={styles.inputGroup}>
                        <Text style={styles.label}>Your Gmail ID</Text>
                        <TextInput
                            style={styles.input}
                            placeholder="your.email@gmail.com"
                            placeholderTextColor={broadcastTheme.colors.slate500}
                            value={email}
                            onChangeText={setEmail}
                            keyboardType="email-address"
                            autoCapitalize="none"
                            autoCorrect={false}
                            autoComplete="email"
                            editable={!isSending}
                        />
                    </View>

                    {/* Message Input */}
                    <View style={styles.inputGroup}>
                        <Text style={styles.label}>Message</Text>
                        <TextInput
                            style={[styles.input, styles.messageInput]}
                            placeholder="How can we help you?"
                            placeholderTextColor={broadcastTheme.colors.slate500}
                            value={message}
                            onChangeText={setMessage}
                            multiline
                            numberOfLines={6}
                            textAlignVertical="top"
                            editable={!isSending}
                        />
                    </View>

                    {/* Send Button */}
                    <TouchableOpacity
                        style={[styles.sendButton, isSending && styles.sendButtonDisabled]}
                        onPress={handleSend}
                        disabled={isSending}
                        activeOpacity={0.8}
                    >
                        <Text style={styles.sendButtonText}>
                            {isSending ? 'Sending…' : 'Send'}
                        </Text>
                    </TouchableOpacity>

                    {/* Dev-only debug info */}
                    {debugInfo && (
                        <Text style={styles.debugText}>{debugInfo}</Text>
                    )}
                </ScrollView>
            </KeyboardAvoidingView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: broadcastTheme.colors.background,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingTop: 50,
        paddingBottom: 12,
        paddingHorizontal: 16,
        backgroundColor: broadcastTheme.colors.background,
        borderBottomWidth: 1,
        borderBottomColor: broadcastTheme.colors.borderDefault,
    },
    backButton: {
        width: 40,
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
    },
    headerTitle: {
        flex: 1,
        fontSize: 18,
        fontWeight: '700' as '700',
        color: broadcastTheme.colors.slate50,
        textAlign: 'center',
        marginRight: 40,
    },
    headerSpacer: {
        width: 40,
    },
    content: {
        flex: 1,
    },
    scrollView: {
        flex: 1,
    },
    scrollContent: {
        padding: 24,
    },
    inputGroup: {
        marginBottom: 24,
    },
    label: {
        fontSize: 14,
        fontWeight: '600' as '600',
        color: broadcastTheme.colors.slate300,
        marginBottom: 8,
    },
    input: {
        backgroundColor: broadcastTheme.colors.slate900,
        borderWidth: 1,
        borderColor: broadcastTheme.colors.borderDefault,
        borderRadius: broadcastTheme.radii.lg,
        paddingHorizontal: 16,
        paddingVertical: 14,
        fontSize: 15,
        color: broadcastTheme.colors.slate50,
    },
    messageInput: {
        minHeight: 140,
        paddingTop: 14,
    },
    sendButton: {
        backgroundColor: broadcastTheme.colors.sky400,
        borderRadius: broadcastTheme.radii.lg,
        paddingVertical: 16,
        alignItems: 'center',
        marginTop: 16,
        shadowColor: broadcastTheme.colors.sky400,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 4,
    },
    sendButtonDisabled: {
        opacity: 0.6,
    },
    sendButtonText: {
        fontSize: 16,
        fontWeight: '700' as '700',
        color: broadcastTheme.colors.slate950,
    },
    debugText: {
        fontSize: 11,
        color: broadcastTheme.colors.amber200,
        marginTop: 12,
        fontFamily: 'monospace',
        opacity: 0.8,
    },
});
