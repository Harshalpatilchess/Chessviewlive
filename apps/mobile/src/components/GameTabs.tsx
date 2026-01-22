import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated, LayoutChangeEvent, useWindowDimensions } from 'react-native';

export type TabType = 'engine' | 'notation' | 'commentary';

interface GameTabsProps {
    activeTab: TabType;
    onTabChange: (tab: TabType) => void;
}

const TABS: { id: TabType; label: string }[] = [
    { id: 'notation', label: 'Notation' },
    { id: 'engine', label: 'Engine' },
    { id: 'commentary', label: 'Commentary' },
];

export default function GameTabs({ activeTab, onTabChange }: GameTabsProps) {
    const [layoutWidth, setLayoutWidth] = useState(0);
    const animatedValue = useRef(new Animated.Value(0)).current;

    // Web-parity constants
    const PADDING_X = 8; // px-2
    const GAP = 8;       // gap-2
    const INSET_X = 16;  // inset-x-4

    // Calculate tab dimensions
    // Available width = layoutWidth - (PADDING_X * 2) - (GAP * 2)
    // Tab width = Available / 3
    const tabWidth = layoutWidth > 0 ? (layoutWidth - (PADDING_X * 2) - (GAP * 2)) / 3 : 0;

    useEffect(() => {
        const index = TABS.findIndex(t => t.id === activeTab);
        Animated.spring(animatedValue, {
            toValue: index,
            useNativeDriver: true,
            speed: 50,
            bounciness: 0, // Web feels snappy/linear for tabs usually, but "slide" requested.
        }).start();
    }, [activeTab]);

    const translateX = animatedValue.interpolate({
        inputRange: [0, 1, 2],
        outputRange: [
            PADDING_X + INSET_X,
            PADDING_X + tabWidth + GAP + INSET_X,
            PADDING_X + (tabWidth + GAP) * 2 + INSET_X
        ],
    });

    const indicatorWidth = tabWidth > 0 ? tabWidth - (INSET_X * 2) : 0;

    return (
        <View
            style={styles.container}
            onLayout={(e: LayoutChangeEvent) => setLayoutWidth(e.nativeEvent.layout.width)}
        >
            {/* Background Pills (Static conditional) */}
            {TABS.map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                    <TouchableOpacity
                        key={tab.id}
                        style={[
                            styles.tab,
                            isActive && styles.activeTabBackground
                        ]}
                        onPress={() => onTabChange(tab.id)}
                        activeOpacity={0.7}
                    >
                        <Text style={[
                            styles.tabLabel,
                            isActive && styles.activeTabLabel
                        ]}>
                            {tab.label}
                        </Text>
                    </TouchableOpacity>
                );
            })}

            {/* Sliding Underline Indicator */}
            {layoutWidth > 0 && (
                <Animated.View
                    style={[
                        styles.underline,
                        {
                            width: indicatorWidth,
                            transform: [{ translateX }],
                        }
                    ]}
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        width: '100%',
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(23, 23, 23, 0.4)', // Slightly more transparent neutral-900 (premiumTheme.colors.bg)
        paddingHorizontal: 8,
        paddingVertical: 2,   // Slim profile
        gap: 4,
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
    },
    tab: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 8,
        borderRadius: 9999,
    },
    activeTabBackground: {
        backgroundColor: 'transparent', // No BG for simpler underline style
    },
    tabLabel: {
        fontSize: 13,
        fontWeight: '600',
        color: '#a3a3a3', // premiumTheme.colors.textSecondary
        letterSpacing: 0.3,
    },
    activeTabLabel: {
        color: '#f5f5f5', // premiumTheme.colors.textPrimary
        fontWeight: '700',
    },
    underline: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        height: 2, // Thinner line
        borderRadius: 1,
        backgroundColor: '#fbbf24', // Amber-400 (premiumTheme.colors.textTertiary/activeTabIndicator)
    },
});
