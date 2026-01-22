import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Pressable, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { broadcastTheme } from '../theme/broadcastTheme';

interface RoundSelectorSheetProps {
    visible: boolean;
    rounds: number[];
    selectedRound: number;
    onSelectRound: (round: number) => void;
    onClose: () => void;
}

export default function RoundSelectorSheet({
    visible,
    rounds,
    selectedRound,
    onSelectRound,
    onClose
}: RoundSelectorSheetProps) {
    const handleSelect = (round: number) => {
        onSelectRound(round);
        onClose();
    };

    return (
        <Modal
            visible={visible}
            transparent={true}
            animationType="slide"
            onRequestClose={onClose}
        >
            <Pressable style={styles.overlay} onPress={onClose}>
                <View style={styles.sheet}>
                    {/* Header */}
                    <View style={styles.header}>
                        <Text style={styles.title}>Select Round</Text>
                        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                            <Ionicons name="close" size={24} color={broadcastTheme.colors.slate300} />
                        </TouchableOpacity>
                    </View>

                    {/* Round List */}
                    <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
                        {rounds.map((round) => {
                            const isSelected = round === selectedRound;
                            return (
                                <TouchableOpacity
                                    key={round}
                                    style={[
                                        styles.roundItem,
                                        isSelected && styles.roundItemSelected
                                    ]}
                                    onPress={() => handleSelect(round)}
                                    activeOpacity={0.7}
                                >
                                    <Text style={[
                                        styles.roundText,
                                        isSelected && styles.roundTextSelected
                                    ]}>
                                        Round {round}
                                    </Text>
                                    {isSelected && (
                                        <Ionicons
                                            name="checkmark-circle"
                                            size={22}
                                            color={broadcastTheme.colors.sky400}
                                        />
                                    )}
                                </TouchableOpacity>
                            );
                        })}
                    </ScrollView>
                </View>
            </Pressable>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        justifyContent: 'flex-end',
    },
    sheet: {
        backgroundColor: broadcastTheme.colors.slate900,
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        paddingBottom: 20,
        maxHeight: '70%',
        borderTopWidth: 1,
        borderLeftWidth: 1,
        borderRightWidth: 1,
        borderColor: broadcastTheme.colors.borderDefault,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingTop: 20,
        paddingBottom: 16,
        borderBottomWidth: 1,
        borderBottomColor: broadcastTheme.colors.borderDefault,
    },
    title: {
        fontSize: 18,
        fontWeight: '700',
        color: broadcastTheme.colors.slate50,
    },
    closeButton: {
        padding: 4,
    },
    scrollView: {
        paddingHorizontal: 20,
    },
    roundItem: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 16,
        paddingHorizontal: 16,
        marginTop: 12,
        backgroundColor: broadcastTheme.colors.slate800,
        borderRadius: broadcastTheme.radii.lg,
        borderWidth: 1,
        borderColor: broadcastTheme.colors.borderDefault,
        minHeight: 56, // Proper touch target
    },
    roundItemSelected: {
        backgroundColor: 'rgba(56, 189, 248, 0.12)', // sky-400 with 12% opacity
        borderColor: 'rgba(56, 189, 248, 0.5)', // sky-400 with 50% opacity
    },
    roundText: {
        fontSize: 16,
        fontWeight: '600',
        color: broadcastTheme.colors.slate200,
    },
    roundTextSelected: {
        color: broadcastTheme.colors.sky400,
        fontWeight: '700',
    },
});
