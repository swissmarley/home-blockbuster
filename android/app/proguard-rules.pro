# kotlinx.serialization
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers @kotlinx.serialization.Serializable class com.swissmarley.homeblockbuster.** {
    *** Companion;
    kotlinx.serialization.KSerializer serializer(...);
}
-keepclasseswithmembers class com.swissmarley.homeblockbuster.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-dontwarn org.slf4j.**
