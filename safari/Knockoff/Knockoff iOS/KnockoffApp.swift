//
//  KnockoffApp.swift
//  Knockoff iOS
//
//  The iOS/iPadOS container app. It exists only to host the Safari web
//  extension and point people at the toggle in Settings — all the filtering
//  work happens in the shared extension, same as on macOS.
//

import SwiftUI

@main
struct KnockoffApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
